import { describe, expect, it, vi } from 'vitest';

import { AlertService, buildPayload } from './alerts';

const URL = 'https://discord.com/api/webhooks/1/abc';

function fakeFetch(status = 204) {
  return vi.fn((_url: string | URL | Request, _init?: RequestInit) =>
    Promise.resolve(new Response(null, { status })),
  );
}

describe('AlertService', () => {
  it('sem webhook não faz requisição nenhuma', async () => {
    const fetch = fakeFetch();
    const alerts = new AlertService({ fetch });
    expect(alerts.enabled).toBe(false);
    expect(await alerts.send({ kind: 'a', title: 'x' })).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('silencia o mesmo alerta dentro da janela de dedupe', async () => {
    let now = 0;
    const fetch = fakeFetch();
    const alerts = new AlertService({
      webhookUrl: URL,
      fetch,
      now: () => now,
      dedupeWindowMs: 1_000,
    });

    expect(await alerts.send({ kind: 'erro', title: 'x' })).toBe(true);
    expect(await alerts.send({ kind: 'erro', title: 'x' })).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);

    now = 1_500;
    expect(await alerts.send({ kind: 'erro', title: 'x' })).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('`force` passa por cima do dedupe', async () => {
    const fetch = fakeFetch();
    const alerts = new AlertService({ webhookUrl: URL, fetch, now: () => 0 });
    await alerts.send({ kind: 'boot', title: 'x', force: true });
    await alerts.send({ kind: 'boot', title: 'x', force: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('conta as repetições silenciadas no envio seguinte', async () => {
    let now = 0;
    const fetch = fakeFetch();
    const alerts = new AlertService({
      webhookUrl: URL,
      fetch,
      now: () => now,
      dedupeWindowMs: 1_000,
    });

    await alerts.send({ kind: 'erro', title: 'x' });
    await alerts.send({ kind: 'erro', title: 'x' });
    await alerts.send({ kind: 'erro', title: 'x' });

    now = 2_000;
    await alerts.send({ kind: 'erro', title: 'x' });

    const body = JSON.parse(String(fetch.mock.calls[1]?.[1]?.body ?? '{}')) as {
      embeds: { fields: { name: string; value: string }[] }[];
    };
    expect(body.embeds[0]?.fields).toContainEqual({
      name: 'Repetições silenciadas',
      value: '2',
      inline: true,
    });
  });

  it('nunca lança quando o webhook falha', async () => {
    const fetch = vi.fn(() => Promise.reject(new Error('rede caiu')));
    const alerts = new AlertService({ webhookUrl: URL, fetch });
    await expect(alerts.send({ kind: 'a', title: 'x' })).resolves.toBe(false);
  });

  it('monta um embed com título em caixa alta e cor do nível', () => {
    const payload = buildPayload({ kind: 'a', title: 'bot no ar', level: 'success' }) as {
      embeds: { title: string; color: number }[];
    };
    expect(payload.embeds[0]?.title).toBe('> BOT NO AR');
    expect(payload.embeds[0]?.color).toBe(0x16a34a);
  });
});
