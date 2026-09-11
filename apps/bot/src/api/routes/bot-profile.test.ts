import { Collection, DiscordAPIError } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';

import { createApiApp, isImageUploadRoute } from '../server';

import type { ApiDeps } from '../context';

const TOKEN = 'a'.repeat(64);
const GUILD = '200000000000000002';
const BOT_ID = '100000000000000001';
const ADMIN_ID = '300000000000000003';
const MEMBRO_ID = '400000000000000004';

const auth = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** Um membro o bastante para `toMemberLike` e `resolveLevel`. */
function fakeMember(id: string, options: { owner?: boolean } = {}) {
  return {
    id,
    user: { bot: false, tag: `${id}#0000` },
    guild: { ownerId: options.owner ? id : BOT_ID },
    permissions: { has: () => false },
    roles: { cache: new Collection(), highest: { position: 1 } },
  };
}

function makeApp(
  options: { changeNickname?: boolean; editMe?: () => Promise<unknown>; bio?: string | null } = {},
) {
  const changeNickname = options.changeNickname ?? true;

  const botMember = {
    id: BOT_ID,
    nickname: 'Goodbot',
    displayName: 'Goodbot',
    avatarURL: () => 'https://cdn.example/guild-avatar.png',
    bannerURL: () => null,
    permissions: { has: (flag: string) => (flag === 'ChangeNickname' ? changeNickname : true) },
  };

  const edited = {
    ...botMember,
    nickname: 'Moderador',
    displayName: 'Moderador',
    avatarURL: () => null,
  };

  const editMe = vi.fn<(payload: Record<string, unknown>) => Promise<unknown>>(
    options.editMe ?? (() => Promise.resolve(edited)),
  );

  const guild = {
    id: GUILD,
    members: {
      me: botMember,
      cache: new Collection<string, unknown>([
        [ADMIN_ID, fakeMember(ADMIN_ID, { owner: true })],
        [MEMBRO_ID, fakeMember(MEMBRO_ID)],
      ]),
      editMe,
    },
  };

  // `getBotBio` faz um select; `setBotBio` dois inserts. O que foi parar em
  // `inserted` é o espelho da bio, que os testes conferem.
  const inserted: unknown[] = [];
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve([{ botBio: options.bio ?? null }]) }),
      }),
    }),
    insert: () => ({
      values: (row: Record<string, unknown>) => {
        if ('botBio' in row) inserted.push(row);
        return {
          onConflictDoNothing: () => Promise.resolve(),
          onConflictDoUpdate: () => Promise.resolve(),
        };
      },
    }),
  };

  const deps = {
    client: {
      guilds: { cache: new Collection([[GUILD, guild]]) },
      user: {
        globalName: null,
        username: 'Goodbot',
        displayAvatarURL: () => 'https://cdn.example/global.png',
      },
    },
    config: { getSettings: () => Promise.resolve({ adminRoleIds: [], modRoleIds: [] }) },
    db,
  } as unknown as ApiDeps;

  const app = createApiApp({
    deps,
    token: TOKEN,
    port: 0,
    admin: { discordToken: 'token', clientId: '500000000000000005' },
  });
  return { app, editMe, inserted };
}

const patch = (body: unknown) => ({ method: 'PATCH', headers: auth, body: JSON.stringify(body) });

describe('GET /guilds/:id/bot-profile', () => {
  it('devolve o perfil do servidor com o global ao lado', async () => {
    const { app } = makeApp({ bio: 'moderação sem drama' });
    const res = await app.request(`/guilds/${GUILD}/bot-profile`, { headers: auth });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      bio: 'moderação sem drama',
      nick: 'Goodbot',
      globalName: 'Goodbot',
      avatarUrl: 'https://cdn.example/guild-avatar.png',
      globalAvatarUrl: 'https://cdn.example/global.png',
      bannerUrl: null,
      permissions: { changeNickname: true },
    });
  });

  it('sem Bearer não responde nada', async () => {
    const { app } = makeApp();
    expect((await app.request(`/guilds/${GUILD}/bot-profile`)).status).toBe(401);
  });
});

describe('PATCH /guilds/:id/bot-profile', () => {
  it('só admin salva', async () => {
    const { app, editMe } = makeApp();
    const res = await app.request(
      `/guilds/${GUILD}/bot-profile`,
      patch({ actorId: MEMBRO_ID, nick: 'Moderador' }),
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: 'ACTOR_NOT_ADMIN' } });
    expect(editMe).not.toHaveBeenCalled();
  });

  it('manda para o Discord só o que o formulário tocou', async () => {
    const { app, editMe } = makeApp();
    const res = await app.request(
      `/guilds/${GUILD}/bot-profile`,
      patch({ actorId: ADMIN_ID, nick: 'Moderador', avatar: PNG }),
    );

    expect(res.status).toBe(200);
    const sent = editMe.mock.calls[0]?.[0];
    expect(sent).toMatchObject({ nick: 'Moderador', avatar: PNG });
    // A capa não foi tocada: não pode virar remoção.
    expect(sent).not.toHaveProperty('banner');
  });

  it('apelido vazio remove o apelido, e `null` na imagem remove a imagem', async () => {
    const { app, editMe } = makeApp();
    await app.request(
      `/guilds/${GUILD}/bot-profile`,
      patch({ actorId: ADMIN_ID, nick: '', avatar: null }),
    );

    expect(editMe.mock.calls[0]?.[0]).toMatchObject({ nick: null, avatar: null });
  });

  it('grava o espelho da bio só depois de o Discord aceitar', async () => {
    const { app, editMe, inserted } = makeApp();
    const res = await app.request(
      `/guilds/${GUILD}/bot-profile`,
      patch({ actorId: ADMIN_ID, nick: 'Goodbot', bio: 'moderação sem drama' }),
    );

    expect(res.status).toBe(200);
    expect(editMe.mock.calls[0]?.[0]).toMatchObject({ bio: 'moderação sem drama' });
    expect(inserted).toContainEqual({ guildId: GUILD, botBio: 'moderação sem drama' });
  });

  it('Discord recusando, o espelho da bio não é gravado', async () => {
    const { app, inserted } = makeApp({
      editMe: () =>
        Promise.reject(
          new DiscordAPIError(
            { code: 50035, message: 'Invalid Form Body' },
            50035,
            400,
            'PATCH',
            'https://discord.com/api/v10/guilds/x/members/@me',
            { body: undefined, files: undefined },
          ),
        ),
    });
    await app.request(
      `/guilds/${GUILD}/bot-profile`,
      patch({ actorId: ADMIN_ID, nick: 'Goodbot', bio: 'nunca gravada' }),
    );

    expect(inserted).toHaveLength(0);
  });

  it('sem `CHANGE_NICKNAME` recusa antes de falar com o Discord', async () => {
    const { app, editMe } = makeApp({ changeNickname: false });
    const res = await app.request(
      `/guilds/${GUILD}/bot-profile`,
      patch({ actorId: ADMIN_ID, nick: 'Outro' }),
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: 'MISSING_CHANGE_NICKNAME' } });
    expect(editMe).not.toHaveBeenCalled();
  });

  it('sem `CHANGE_NICKNAME` ainda deixa trocar a imagem, se o apelido não mudou', async () => {
    const { app, editMe } = makeApp({ changeNickname: false });
    const res = await app.request(
      `/guilds/${GUILD}/bot-profile`,
      patch({ actorId: ADMIN_ID, nick: 'Goodbot', avatar: PNG }),
    );

    expect(res.status).toBe(200);
    expect(editMe).toHaveBeenCalled();
  });

  it('400 do Discord vira erro que diz quais campos foram junto', async () => {
    const { app } = makeApp({
      editMe: () =>
        Promise.reject(
          new DiscordAPIError(
            { code: 50035, message: 'Invalid Form Body' },
            50035,
            400,
            'PATCH',
            'https://discord.com/api/v10/guilds/x/members/@me',
            { body: undefined, files: undefined },
          ),
        ),
    });
    const res = await app.request(
      `/guilds/${GUILD}/bot-profile`,
      patch({ actorId: ADMIN_ID, nick: 'Moderador', banner: PNG }),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('BOT_PROFILE_REJECTED');
    expect(body.error.message).toContain('capa');
    expect(body.error.message).not.toContain('avatar');
  });
});

describe('teto de corpo', () => {
  it('a rota do perfil aceita imagem, como as outras que sobem arquivo', () => {
    expect(isImageUploadRoute('PATCH', `/guilds/${GUILD}/bot-profile`)).toBe(true);
    expect(isImageUploadRoute('GET', `/guilds/${GUILD}/bot-profile`)).toBe(false);
  });
});
