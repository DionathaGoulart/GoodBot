import { BROADCAST_CONFIRMATION } from '@goodbot/shared';
import { Collection } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';

import { createApiApp } from '../server';

import type { ApiDeps } from '../context';

const TOKEN = 'a'.repeat(64);
const OWNER_ID = '100000000000000001';
const ESTRANHO_ID = '900000000000000009';
const GUILD_A = '200000000000000002';
const GUILD_B = '300000000000000003';

const auth = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };

/** Guild o bastante para `noticeChannel`, `canBotSend` e o mapper do admin. */
function fakeGuild(id: string, name: string, options: { canSend?: boolean } = {}) {
  const canSend = options.canSend ?? true;
  const me = { id: 'bot' };
  const channel = {
    id: `${id}-canal`,
    name: 'geral',
    // `ChannelType.GuildText`.
    type: 0,
    rawPosition: 0,
    isTextBased: () => true,
    send: vi.fn(() => Promise.resolve({})),
    permissionsFor: () => ({ has: () => canSend }),
  };
  const guild = {
    id,
    name,
    iconURL: () => `https://cdn.example/${id}.png`,
    memberCount: 42,
    ownerId: '400000000000000004',
    joinedAt: new Date('2026-01-01T00:00:00Z'),
    systemChannel: channel,
    members: { cache: new Collection(), me },
    channels: { cache: new Collection([[channel.id, channel]]) },
    client: { users: { cache: new Collection() } },
    leave: vi.fn(() => Promise.resolve({})),
    channel,
  };
  // `canBotSend` sobe do canal para a guild atrás do membro do bot.
  Object.assign(channel, { guild });
  return guild;
}

function makeApp(options: { ownerId?: string; served?: string[] } = {}) {
  const guildA = fakeGuild(GUILD_A, 'Servidor A');
  const guildB = fakeGuild(GUILD_B, 'Servidor B');
  const setMaintenance = vi.fn(() =>
    Promise.resolve({ enabled: true, message: null, since: null, by: OWNER_ID }),
  );
  const announceDeploy = vi.fn((kind: string) =>
    Promise.resolve({ kind, expectedAt: '2026-09-22T12:01:00.000Z', total: 2, delivered: 2 }),
  );

  const deps = {
    client: {
      guilds: {
        cache: new Collection([
          [GUILD_A, guildA],
          [GUILD_B, guildB],
        ]),
      },
      ws: { ping: 1, status: 0 },
      isReady: () => true,
    },
    db: { execute: () => Promise.resolve([]) },
    commands: new Collection(),
    registry: { servedGuildIds: () => options.served ?? [GUILD_A, GUILD_B] },
    maintenance: {
      current: () => ({ enabled: false, message: null, since: null, by: null }),
      set: setMaintenance,
    },
    deployNotice: { announce: announceDeploy },
  } as unknown as ApiDeps;

  const app = createApiApp({
    deps,
    token: TOKEN,
    port: 0,
    admin: {
      ...(options.ownerId === undefined ? {} : { ownerId: options.ownerId }),
      discordToken: 'token',
      clientId: '500000000000000005',
    },
  });
  return { app, guildA, guildB, setMaintenance, announceDeploy };
}

/**
 * A tranca do painel admin. O Bearer prova que a chamada veio do painel; o que
 * estes testes cobrem é a segunda pergunta — **quem** estava na frente dele.
 */
describe('auth das rotas /admin', () => {
  it('sem Bearer não responde nada', async () => {
    const { app } = makeApp({ ownerId: OWNER_ID });
    expect((await app.request('/admin/guilds')).status).toBe(401);
  });

  it('recusa a escrita de quem não é o dono do bot', async () => {
    const { app, guildA } = makeApp({ ownerId: OWNER_ID });
    const res = await app.request(`/admin/guilds/${GUILD_A}/leave`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ actorId: ESTRANHO_ID }),
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: 'NOT_BOT_OWNER' } });
    expect(guildA.leave).not.toHaveBeenCalled();
  });

  it('sem OWNER_DISCORD_ID no ambiente ninguém escreve, nem o dono', async () => {
    const { app, guildA } = makeApp();
    const res = await app.request(`/admin/guilds/${GUILD_A}/leave`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ actorId: OWNER_ID }),
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: 'OWNER_NOT_CONFIGURED' } });
    expect(guildA.leave).not.toHaveBeenCalled();
  });
});

describe('sair de um servidor', () => {
  it('avisa antes e sai', async () => {
    const { app, guildA } = makeApp({ ownerId: OWNER_ID });
    const res = await app.request(`/admin/guilds/${GUILD_A}/leave`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ actorId: OWNER_ID, reason: 'spam' }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      guildId: GUILD_A,
      name: 'Servidor A',
      announced: true,
    });
    expect(guildA.channel.send).toHaveBeenCalled();
    expect(guildA.leave).toHaveBeenCalled();
  });

  it('`announce: false` sai calado', async () => {
    const { app, guildA } = makeApp({ ownerId: OWNER_ID });
    const res = await app.request(`/admin/guilds/${GUILD_A}/leave`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ actorId: OWNER_ID, announce: false }),
    });

    expect(res.status).toBe(200);
    expect(guildA.channel.send).not.toHaveBeenCalled();
    expect(guildA.leave).toHaveBeenCalled();
  });
});

describe('broadcast', () => {
  it('exige a palavra de confirmação no corpo', async () => {
    const { app, guildA } = makeApp({ ownerId: OWNER_ID });
    const res = await app.request('/admin/broadcast', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ actorId: OWNER_ID, title: 't', message: 'm', confirm: 'sim' }),
    });

    expect(res.status).toBe(400);
    expect(guildA.channel.send).not.toHaveBeenCalled();
  });

  it('o ensaio lista os alvos sem mandar nada', async () => {
    const { app, guildA, guildB } = makeApp({ ownerId: OWNER_ID });
    const res = await app.request('/admin/broadcast', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        actorId: OWNER_ID,
        title: 'Aviso',
        message: 'Texto',
        confirm: BROADCAST_CONFIRMATION,
        dryRun: true,
      }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ dryRun: true, total: 2, delivered: 0, failed: 0 });
    expect(guildA.channel.send).not.toHaveBeenCalled();
    expect(guildB.channel.send).not.toHaveBeenCalled();
  });

  it('vai só para os servidores atendidos, nunca para a fila', async () => {
    const { app, guildA, guildB } = makeApp({ ownerId: OWNER_ID, served: [GUILD_A] });
    const res = await app.request('/admin/broadcast', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        actorId: OWNER_ID,
        title: 'Aviso',
        message: 'Texto',
        confirm: BROADCAST_CONFIRMATION,
      }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ total: 1, delivered: 1, failed: 0 });
    expect(guildA.channel.send).toHaveBeenCalled();
    expect(guildB.channel.send).not.toHaveBeenCalled();
  });
});

describe('manutenção', () => {
  it('lê sem actorId, escreve só com o dono', async () => {
    const { app, setMaintenance } = makeApp({ ownerId: OWNER_ID });

    const leitura = await app.request('/admin/maintenance', { headers: auth });
    expect(leitura.status).toBe(200);
    expect(await leitura.json()).toMatchObject({ enabled: false });

    const recusada = await app.request('/admin/maintenance', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ actorId: ESTRANHO_ID, enabled: true }),
    });
    expect(recusada.status).toBe(403);
    expect(setMaintenance).not.toHaveBeenCalled();

    const aceita = await app.request('/admin/maintenance', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ actorId: OWNER_ID, enabled: true, message: '  volto já  ' }),
    });
    expect(aceita.status).toBe(200);
    expect(setMaintenance).toHaveBeenCalledWith({
      enabled: true,
      message: 'volto já',
      by: OWNER_ID,
    });
  });
});

describe('aviso de deploy', () => {
  const post = (app: ReturnType<typeof makeApp>['app'], body: unknown) =>
    app.request('/admin/deploy-notice', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify(body),
    });

  it('só o dono publica, com um dos tipos que reiniciam o bot', async () => {
    const { app, announceDeploy } = makeApp({ ownerId: OWNER_ID });

    expect((await post(app, { actorId: ESTRANHO_ID, kind: 'restart' })).status).toBe(403);
    expect((await post(app, { actorId: OWNER_ID, kind: 'none' })).status).toBe(400);
    expect(announceDeploy).not.toHaveBeenCalled();

    const res = await post(app, { actorId: OWNER_ID, kind: 'database' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ kind: 'database', delivered: 2 });
    expect(announceDeploy).toHaveBeenCalledWith('database');
  });

  it('sem OWNER_DISCORD_ID no ambiente o deploy não avisa', async () => {
    const { app, announceDeploy } = makeApp();

    const res = await post(app, { actorId: OWNER_ID, kind: 'restart' });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: 'OWNER_NOT_CONFIGURED' } });
    expect(announceDeploy).not.toHaveBeenCalled();
  });
});
