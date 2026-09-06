import { Collection, PermissionFlagsBits } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createApiApp } from './server';
import { DEFAULT_SETTINGS } from '../services/config';

import type { ApiDeps } from './context';

const TOKEN = 'a'.repeat(64);
const GUILD_ID = '100000000000000001';
const ACTOR_ID = '200000000000000002';
const TARGET_ID = '300000000000000003';

const auth = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };

/** Membro o bastante para `toMemberLike`, `fetchMember` e os mappers. */
function fakeMember(id: string, options: { mod?: boolean; guild?: unknown } = {}) {
  return {
    id,
    guild: options.guild,
    user: {
      id,
      bot: false,
      username: `u${id}`,
      tag: `u${id}#0`,
      displayName: `u${id}`,
      createdAt: new Date(0),
    },
    displayName: `u${id}`,
    displayAvatarURL: () => `https://cdn.example/${id}.png`,
    joinedAt: new Date(0),
    communicationDisabledUntil: null,
    pending: false,
    roles: {
      cache: new Collection<string, { id: string }>(),
      highest: { position: options.mod === true ? 5 : 1 },
    },
    permissions: {
      has: (flag: bigint) => options.mod === true && flag === PermissionFlagsBits.BanMembers,
    },
  };
}

interface Fakes {
  deps: ApiDeps;
  warn: ReturnType<typeof vi.fn>;
  invalidate: ReturnType<typeof vi.fn>;
  members: Map<string, ReturnType<typeof fakeMember>>;
}

function makeDeps(overrides: { warn?: () => unknown } = {}): Fakes {
  const members = new Map<string, ReturnType<typeof fakeMember>>();
  const guild = {
    id: GUILD_ID,
    ownerId: '900000000000000009',
    members: {
      cache: members,
      me: undefined as unknown,
      fetch: () => Promise.reject(new Error('não está no servidor')),
    },
  };
  members.set(ACTOR_ID, fakeMember(ACTOR_ID, { mod: true, guild }));
  members.set(TARGET_ID, fakeMember(TARGET_ID, { guild }));
  guild.members.me = fakeMember('400000000000000004', { guild });

  const warn = vi.fn(
    overrides.warn ??
      (() => ({
        case: {
          id: 7,
          caseNumber: 3,
          type: 'warn' as const,
          expiresAt: null,
        },
        dmSent: true,
      })),
  );
  const invalidate = vi.fn();

  const deps = {
    client: {
      guilds: { cache: new Map([[GUILD_ID, guild]]) },
      users: { fetch: (id: string) => Promise.resolve({ id, bot: false, tag: `u${id}#0` }) },
      ws: { ping: 42, status: 0 },
      isReady: () => true,
    },
    db: { execute: () => Promise.resolve([]) },
    config: {
      getSettings: () => Promise.resolve({ guildId: GUILD_ID, ...DEFAULT_SETTINGS, stored: true }),
      publishInvalidate: invalidate,
    },
    moderation: {
      warn,
      assertCanAct: () => Promise.resolve(),
    },
    reactionRoles: {},
    tickets: {},
  } as unknown as ApiDeps;

  return { deps, warn, invalidate, members };
}

function makeApp(overrides?: { warn?: () => unknown }) {
  const fakes = makeDeps(overrides);
  return { ...fakes, app: createApiApp({ deps: fakes.deps, token: TOKEN, port: 0 }) };
}

describe('auth', () => {
  it('sem token responde 401', async () => {
    const { app } = makeApp();
    const res = await app.request(`/guilds/${GUILD_ID}/roles`);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Token inválido.' },
    });
  });

  it('token errado responde 401, do mesmo jeito', async () => {
    const { app } = makeApp();
    const res = await app.request(`/guilds/${GUILD_ID}/roles`, {
      headers: { authorization: `Bearer ${'b'.repeat(64)}` },
    });
    expect(res.status).toBe(401);
  });

  it('token de tamanho diferente não quebra a comparação', async () => {
    const { app } = makeApp();
    const res = await app.request(`/guilds/${GUILD_ID}/roles`, {
      headers: { authorization: 'Bearer curto' },
    });
    expect(res.status).toBe(401);
  });

  it('token certo passa', async () => {
    const { app } = makeApp();
    const res = await app.request(`/guilds/${GUILD_ID}/members?limit=5`, { headers: auth });
    expect(res.status).toBe(200);
  });
});

describe('GET /health', () => {
  it('sem token responde só {ok:true}', async () => {
    const { app } = makeApp();
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('com token traz o estado do gateway', async () => {
    const { app } = makeApp();
    const res = await app.request('/health', { headers: auth });
    const body = (await res.json()) as { gateway: { status: string }; guilds: { cached: number } };
    expect(body.gateway.status).toBe('ready');
    expect(body.guilds.cached).toBe(1);
  });
});

describe('validação', () => {
  it('corpo inválido responde 400 com as issues', async () => {
    const { app, warn } = makeApp();
    const res = await app.request(`/guilds/${GUILD_ID}/moderation`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ type: 'ban', targetId: TARGET_ID, actorId: ACTOR_ID }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; issues: { path: string }[] } };
    expect(body.error.code).toBe('VALIDATION');
    expect(body.error.issues.map((issue) => issue.path)).toContain('reason');
    expect(warn).not.toHaveBeenCalled();
  });

  it('guildId que não é snowflake responde 400', async () => {
    const { app } = makeApp();
    const res = await app.request('/guilds/abc/roles', { headers: auth });
    expect(res.status).toBe(400);
  });
});

describe('POST /guilds/:id/moderation', () => {
  it('chama o serviço com source dashboard', async () => {
    const { app, warn } = makeApp();
    const res = await app.request(`/guilds/${GUILD_ID}/moderation`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        type: 'warn',
        targetId: TARGET_ID,
        actorId: ACTOR_ID,
        reason: 'spam',
      }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      caseId: 7,
      caseNumber: 3,
      type: 'warn',
      expiresAt: null,
      dmSent: true,
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatchObject({ source: 'dashboard', reason: 'spam' });
  });

  it('recusa um ator que não é moderador', async () => {
    const { app, members, warn } = makeApp();
    members.set(ACTOR_ID, { ...fakeMember(ACTOR_ID), guild: members.get(TARGET_ID)?.guild });

    const res = await app.request(`/guilds/${GUILD_ID}/moderation`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ type: 'warn', targetId: TARGET_ID, actorId: ACTOR_ID, reason: 'x' }),
    });

    expect(res.status).toBe(403);
    expect(warn).not.toHaveBeenCalled();
  });

  it('429 do Discord vira 503 com retryAfter', async () => {
    const rateLimited = Object.assign(new Error('rate limited'), {
      name: 'RateLimitError',
      retryAfter: 4200,
    });
    const { app } = makeApp({
      warn: () => {
        throw rateLimited;
      },
    });

    const res = await app.request(`/guilds/${GUILD_ID}/moderation`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ type: 'warn', targetId: TARGET_ID, actorId: ACTOR_ID, reason: 'x' }),
    });

    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('5');
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('DISCORD_RATE_LIMITED');
  });
});

describe('POST /guilds/:id/config/invalidate', () => {
  it('publica no ConfigBus', async () => {
    const { app, invalidate } = makeApp();
    const res = await app.request(`/guilds/${GUILD_ID}/config/invalidate`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ module: 'tags' }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(invalidate).toHaveBeenCalledWith(GUILD_ID, 'tags');
  });
});

describe('rate limit', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('a 61ª requisição do mesmo IP recebe 429', async () => {
    const { app } = makeApp();
    const request = () => app.request('/health', { headers: { 'x-forwarded-for': '203.0.113.7' } });

    for (let i = 0; i < 60; i += 1) {
      expect((await request()).status).toBe(200);
    }

    const blocked = await request();
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBeTruthy();
  });
});

describe('rotas desconhecidas', () => {
  it('não listam nada: 404 com o erro padrão', async () => {
    const { app } = makeApp();
    const res = await app.request('/guilds', { headers: auth });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Rota não encontrada.' },
    });
  });
});
