import { DiscordAPIError } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LogQueue, type LogEntry, type LogSender } from './log-queue';

import type { APIEmbed, Message } from 'discord.js';

function embed(title: string): APIEmbed {
  return { title };
}

function entry(title: string): LogEntry {
  return { embeds: [embed(title)] };
}

/** Sender falso que só guarda o que foi "enviado". */
function recorder() {
  const sent: { channelId: string; entry: LogEntry }[] = [];
  const sender: LogSender = (channelId, logEntry) => {
    sent.push({ channelId, entry: logEntry });
    return Promise.resolve({ id: `msg-${sent.length}` } as Message);
  };
  return { sent, sender };
}

/** `DiscordAPIError` sem passar pelo REST: só o que a fila inspeciona. */
function apiError(code: number, status: number, raw: unknown = { code }): DiscordAPIError {
  const error = new DiscordAPIError(
    raw as never,
    code as never,
    status,
    'POST',
    'https://discord.test',
    {},
  );
  return error;
}

describe('LogQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('junta 10 embeds numa única mensagem', async () => {
    const { sent, sender } = recorder();
    const queue = new LogQueue({ sender });

    for (let i = 0; i < 10; i++) queue.push('canal', entry(`log ${i}`));
    await vi.runOnlyPendingTimersAsync();
    await queue.flushAll();

    expect(sent).toHaveLength(1);
    expect(sent[0]?.entry.embeds).toHaveLength(10);
    expect(sent[0]?.channelId).toBe('canal');
  });

  it('50 entradas viram 5 mensagens de 10 embeds', async () => {
    const { sent, sender } = recorder();
    const queue = new LogQueue({ sender });

    for (let i = 0; i < 50; i++) queue.push('canal', entry(`log ${i}`));
    await vi.runOnlyPendingTimersAsync();
    await queue.flushAll();

    expect(sent).toHaveLength(5);
    expect(sent.every((message) => message.entry.embeds.length === 10)).toBe(true);
    expect(queue.pendingCount('canal')).toBe(0);
  });

  it('não envia antes do flush quando a fila não encheu', async () => {
    const { sent, sender } = recorder();
    const queue = new LogQueue({ sender, flushIntervalMs: 2000 });
    queue.start();

    queue.push('canal', entry('só um'));
    expect(sent).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(2000);
    expect(sent).toHaveLength(1);
    queue.stop();
  });

  it('separa canais diferentes em mensagens diferentes', async () => {
    const { sent, sender } = recorder();
    const queue = new LogQueue({ sender });

    queue.push('a', entry('um'));
    queue.push('b', entry('dois'));
    await queue.flushAll();

    expect(sent.map((message) => message.channelId).sort()).toEqual(['a', 'b']);
  });

  it('entrada com anexo vai sozinha, sem agrupar', async () => {
    const { sent, sender } = recorder();
    const queue = new LogQueue({ sender });

    queue.push('canal', { embeds: [embed('bulk')], files: [{ attachment: Buffer.from('x') }] });
    queue.push('canal', entry('outro'));
    await queue.flushAll();

    expect(sent).toHaveLength(2);
    expect(sent[0]?.entry.files).toHaveLength(1);
  });

  it('descarta o canal quando falta permissão', async () => {
    const sender = vi.fn<LogSender>().mockRejectedValue(apiError(50013, 403));
    const queue = new LogQueue({ sender });

    queue.push('canal', entry('um'));
    await queue.flushAll();

    // Segunda tentativa nem chega ao sender: o canal foi marcado como morto.
    expect(queue.push('canal', entry('dois'))).toBe(false);
    await queue.flushAll();
    expect(sender).toHaveBeenCalledTimes(1);
  });

  it('devolve o lote para a próxima passada quando toma 429', async () => {
    let now = 0;
    const sender = vi
      .fn<LogSender>()
      .mockRejectedValueOnce(apiError(0, 429, { retry_after: 3 }))
      .mockResolvedValue({ id: 'msg' } as Message);
    const queue = new LogQueue({ sender, now: () => now });

    queue.push('canal', entry('um'));
    await queue.flushAll();
    expect(queue.pendingCount('canal')).toBe(1);

    // Ainda dentro do backoff: nada é enviado.
    now = 1000;
    await queue.flushAll();
    expect(sender).toHaveBeenCalledTimes(1);

    now = 4000;
    await queue.flushAll();
    expect(sender).toHaveBeenCalledTimes(2);
    expect(queue.pendingCount('canal')).toBe(0);
  });

  it('send devolve a mensagem criada (mod-log precisa do id)', async () => {
    const { sender } = recorder();
    const queue = new LogQueue({ sender });

    const message = await queue.send('canal', entry('caso'));
    expect(message?.id).toBe('msg-1');
  });
});
