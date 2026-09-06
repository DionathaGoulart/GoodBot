import { DEFAULT_STATS_CONFIG, HOUR_MS, MINUTE_MS } from '@cobot/shared';
import { describe, expect, it, vi } from 'vitest';

import { localDayKey, startOfDayInZone, startOfHour, StatsService } from './stats';

import type { StatsConfig } from '@cobot/shared';

const GUILD = '100000000000000001';
const CHANNEL = '200000000000000002';
const USER = '300000000000000003';

/** `2026-09-06T13:37:00Z` — meio de uma hora, para o bucket ser visível. */
const T0 = Date.parse('2026-09-06T13:37:00.000Z');

interface WrittenRow {
  kind: string;
  key: string;
  count: number;
  granularity: string;
  bucketStart: Date;
}

interface Harness {
  stats: StatsService;
  /** Só os buckets: o `ensureGuildRow` também passa pelo `insert`. */
  rows: () => WrittenRow[];
  setNow: (value: number) => void;
}

function harness(config: Partial<StatsConfig> = {}, timezone = 'America/Sao_Paulo'): Harness {
  let now = T0;
  const written: unknown[][] = [];

  // O `db` é um duplo: só o `insert(...).values(...).onConflictDoUpdate(...)`
  // do repositório é exercitado aqui; o SQL real tem teste de integração.
  const chain = {
    values(rows: unknown) {
      written.push(Array.isArray(rows) ? rows : [rows]);
      return chain;
    },
    onConflictDoUpdate: () => Promise.resolve(),
    onConflictDoNothing: () => Promise.resolve(),
  };
  const db = { insert: () => chain } as never;

  const stats = new StatsService({
    db,
    client: { guilds: { cache: new Map() } } as never,
    config: {
      get: () => Promise.resolve({ ...DEFAULT_STATS_CONFIG, ...config }),
      getSettings: () => Promise.resolve({ timezone }),
    } as never,
    now: () => now,
  });

  const rows = (): WrittenRow[] =>
    written.flat().filter((row): row is WrittenRow => typeof row === 'object' && row !== null && 'kind' in row);

  return { stats, rows, setNow: (value) => (now = value) };
}

describe('startOfHour', () => {
  it('trunca para o início da hora UTC', () => {
    expect(startOfHour(T0).toISOString()).toBe('2026-09-06T13:00:00.000Z');
  });
});

describe('startOfDayInZone', () => {
  it('devolve a meia-noite local como instante UTC', () => {
    // São Paulo está em UTC−3 (sem horário de verão desde 2019).
    expect(startOfDayInZone(new Date(T0), 'America/Sao_Paulo').toISOString()).toBe(
      '2026-09-06T03:00:00.000Z',
    );
  });

  it('respeita um fuso à frente de UTC', () => {
    expect(startOfDayInZone(new Date(T0), 'Europe/Lisbon').toISOString()).toBe(
      '2026-09-05T23:00:00.000Z',
    );
  });

  it('cai em UTC quando o fuso é inválido', () => {
    expect(startOfDayInZone(new Date(T0), 'Nao/Existe').toISOString()).toBe(
      '2026-09-06T00:00:00.000Z',
    );
  });

  it('localDayKey usa o dia local, não o UTC', () => {
    // 01:00Z de 7/9 ainda é dia 6 em São Paulo.
    const at = new Date(Date.parse('2026-09-07T01:00:00.000Z'));
    expect(localDayKey(at, 'America/Sao_Paulo')).toBe('2026-09-06');
    expect(localDayKey(at, 'UTC')).toBe('2026-09-07');
  });
});

describe('StatsService — agregação em memória', () => {
  it('soma no mesmo bucket dentro da mesma hora', () => {
    const { stats } = harness();
    stats.increment(GUILD, 'messages_channel', CHANNEL);
    stats.increment(GUILD, 'messages_channel', CHANNEL);
    stats.increment(GUILD, 'messages_channel', CHANNEL, 3);
    expect(stats.pendingSize).toBe(1);
  });

  it('separa buckets quando a hora vira', () => {
    const { stats, setNow } = harness();
    stats.increment(GUILD, 'messages_channel', CHANNEL);
    setNow(T0 + HOUR_MS);
    stats.increment(GUILD, 'messages_channel', CHANNEL);
    expect(stats.pendingSize).toBe(2);
  });

  it('separa buckets por key', () => {
    const { stats } = harness();
    stats.increment(GUILD, 'messages_channel', CHANNEL);
    stats.increment(GUILD, 'messages_channel', '999');
    expect(stats.pendingSize).toBe(2);
  });

  it('ignora incrementos não positivos', () => {
    const { stats } = harness();
    stats.increment(GUILD, 'joins', '_', 0);
    stats.increment(GUILD, 'joins', '_', -2);
    expect(stats.pendingSize).toBe(0);
  });

  it('flush grava um único registro com a soma e esvazia a memória', async () => {
    const { stats, rows } = harness();
    for (let i = 0; i < 20; i++) stats.increment(GUILD, 'messages_channel', CHANNEL);

    expect(await stats.flush()).toBe(1);
    expect(stats.pendingSize).toBe(0);

    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ kind: 'messages_channel', count: 20, granularity: 'hour' });
  });

  it('flush sem nada pendente não toca no banco', async () => {
    const { stats, rows } = harness();
    expect(await stats.flush()).toBe(0);
    expect(rows()).toHaveLength(0);
  });

  it('devolve o lote à memória quando o banco falha', async () => {
    const { stats } = harness();
    const failing = new StatsService({
      db: {
        insert: () => ({
          values: () => ({ onConflictDoUpdate: () => Promise.reject(new Error('sem banco')) }),
        }),
      } as never,
      client: { guilds: { cache: new Map() } } as never,
      config: { get: () => Promise.resolve(DEFAULT_STATS_CONFIG) } as never,
    });
    failing.increment(GUILD, 'joins');
    failing.increment(GUILD, 'joins');
    expect(await failing.flush()).toBe(0);
    expect(failing.pendingSize).toBe(1);
    expect(stats.pendingSize).toBe(0);
  });
});

describe('StatsService — hooks', () => {
  const message = (channelId = CHANNEL, bot = false) =>
    ({ guildId: GUILD, channelId, author: { id: USER, bot } }) as never;

  it('conta a mensagem no canal e no autor', async () => {
    const { stats } = harness();
    await stats.recordMessage(message());
    expect(stats.pendingSize).toBe(2);
  });

  it('não conta bot nem canal ignorado', async () => {
    const { stats } = harness({ ignoredChannelIds: ['999'] });
    await stats.recordMessage(message(CHANNEL, true));
    await stats.recordMessage(message('999'));
    expect(stats.pendingSize).toBe(0);
  });

  it('respeita trackTopUsers e trackMessages', async () => {
    const semUsuarios = harness({ trackTopUsers: false });
    await semUsuarios.stats.recordMessage(message());
    expect(semUsuarios.stats.pendingSize).toBe(1);

    const desligado = harness({ trackMessages: false });
    await desligado.stats.recordMessage(message());
    expect(desligado.stats.pendingSize).toBe(0);
  });

  it('módulo desligado não coleta nada', async () => {
    const { stats } = harness({ enabled: false });
    await stats.recordMessage(message());
    await stats.recordCase(GUILD, 'ban');
    await stats.recordCommand(GUILD, 'ban');
    expect(stats.pendingSize).toBe(0);
  });

  it('comandos e casos entram com o nome/tipo como key', async () => {
    const { stats, rows } = harness();
    await stats.recordCommand(GUILD, 'ban');
    await stats.recordCase(GUILD, 'warn');
    await stats.flush();
    expect(rows()).toContainEqual(expect.objectContaining({ kind: 'commands', key: 'ban' }));
    expect(rows()).toContainEqual(expect.objectContaining({ kind: 'cases_type', key: 'warn' }));
  });
});

describe('StatsService — voz', () => {
  const state = (channelId: string | null) =>
    ({ guild: { id: GUILD }, id: USER, channelId, member: { user: { bot: false } } }) as never;

  it('conta os minutos ao fechar a sessão, não ao abrir', async () => {
    const { stats, setNow, rows } = harness();
    await stats.recordVoice(state(null), state(CHANNEL));
    expect(stats.pendingSize).toBe(0);

    setNow(T0 + 25 * MINUTE_MS);
    await stats.recordVoice(state(CHANNEL), state(null));
    await stats.flush();

    expect(rows()).toEqual([
      expect.objectContaining({ kind: 'voice_minutes_channel', key: CHANNEL, count: 25 }),
    ]);
  });

  it('sessão de menos de um minuto não vira bucket', async () => {
    const { stats, setNow } = harness();
    await stats.recordVoice(state(null), state(CHANNEL));
    setNow(T0 + 30_000);
    await stats.recordVoice(state(CHANNEL), state(null));
    expect(stats.pendingSize).toBe(0);
  });

  it('mudo/ensurdecido no mesmo canal é ignorado', async () => {
    const { stats } = harness();
    await stats.recordVoice(state(CHANNEL), state(CHANNEL));
    expect(stats.pendingSize).toBe(0);
  });
});

describe('StatsService — snapshot de membros', () => {
  const guild = { id: GUILD, memberCount: 1234 } as never;

  it('grava um snapshot diário na meia-noite local', async () => {
    const { stats, rows } = harness();
    expect(await stats.snapshotMembers(guild)).toBe(true);
    await stats.flush();

    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ kind: 'members_total', count: 1234, granularity: 'day' });
    expect(rows()[0]?.bucketStart.toISOString()).toBe('2026-09-06T03:00:00.000Z');
  });

  it('não repete o snapshot no mesmo dia local', async () => {
    const { stats, setNow } = harness();
    await stats.snapshotMembers(guild);
    setNow(T0 + 4 * HOUR_MS);
    expect(await stats.snapshotMembers(guild)).toBe(false);
  });

  it('volta a fotografar quando o dia local vira', async () => {
    const { stats, setNow } = harness();
    await stats.snapshotMembers(guild);
    setNow(T0 + 20 * HOUR_MS);
    expect(await stats.snapshotMembers(guild)).toBe(true);
  });

  it('start dispara o snapshot das guilds em cache', async () => {
    const { stats } = harness();
    const spy = vi.spyOn(stats, 'snapshotAllGuilds');
    stats.start();
    stats.stop();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
