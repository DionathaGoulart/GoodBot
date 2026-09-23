import { UserFacingError } from '@goodbot/shared';
import { Collection } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';

import { createApiApp } from '../server';

import type { ApiDeps } from '../context';

const TOKEN = 'a'.repeat(64);
const GUILD = '200000000000000002';
const BOT_ID = '100000000000000001';
const ADMIN_ID = '300000000000000003';
const MEMBRO_ID = '400000000000000004';
const CHANNEL_ID = '500000000000000005';
const MESSAGE_ID = '600000000000000006';

const auth = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };

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

function makeApp(publish: () => Promise<unknown>) {
  const guild = {
    id: GUILD,
    members: {
      cache: new Collection<string, unknown>([
        [ADMIN_ID, fakeMember(ADMIN_ID, { owner: true })],
        [MEMBRO_ID, fakeMember(MEMBRO_ID)],
      ]),
    },
  };
  const squadPanel = { publish: vi.fn(publish) };
  const deps = {
    client: { guilds: { cache: new Collection([[GUILD, guild]]) } },
    config: { getSettings: () => Promise.resolve({ adminRoleIds: [], modRoleIds: [] }) },
    squadPanel,
  } as unknown as ApiDeps;

  const app = createApiApp({
    deps,
    token: TOKEN,
    port: 0,
    admin: { discordToken: 'token', clientId: '700000000000000007' },
  });
  return { app, squadPanel };
}

const post = (body: unknown) => ({ method: 'POST', headers: auth, body: JSON.stringify(body) });
const PATH = `/guilds/${GUILD}/squads/panel`;

describe('POST /guilds/:id/squads/panel', () => {
  it('publica pelo mesmo caminho do /squad painel, com origem no painel', async () => {
    const { app, squadPanel } = makeApp(() =>
      Promise.resolve({ channelId: CHANNEL_ID, messageId: MESSAGE_ID, created: true }),
    );
    const res = await app.request(PATH, post({ actorId: ADMIN_ID }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      channelId: CHANNEL_ID,
      messageId: MESSAGE_ID,
      created: true,
    });
    expect(squadPanel.publish).toHaveBeenCalledWith(
      expect.objectContaining({ id: GUILD }),
      ADMIN_ID,
      'dashboard',
    );
  });

  it('só admin publica', async () => {
    const { app, squadPanel } = makeApp(() => Promise.reject(new Error('não chega aqui')));
    const res = await app.request(PATH, post({ actorId: MEMBRO_ID }));

    expect(res.status).toBe(403);
    expect(squadPanel.publish).not.toHaveBeenCalled();
  });

  it('sem actorId recusa antes de publicar', async () => {
    const { app, squadPanel } = makeApp(() => Promise.reject(new Error('não chega aqui')));
    const res = await app.request(PATH, post({}));

    expect(res.status).toBe(400);
    expect(squadPanel.publish).not.toHaveBeenCalled();
  });

  it('a falta que o serviço explica chega ao painel como veio', async () => {
    const { app } = makeApp(() =>
      Promise.reject(
        new UserFacingError('Escolha no painel web um canal de texto para o painel de squads.', {
          code: 'SQUADS_NO_PANEL_CHANNEL',
        }),
      ),
    );
    const res = await app.request(PATH, post({ actorId: ADMIN_ID }));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: {
        code: 'SQUADS_NO_PANEL_CHANNEL',
        message: 'Escolha no painel web um canal de texto para o painel de squads.',
      },
    });
  });

  it('sem Bearer não responde nada', async () => {
    const { app } = makeApp(() => Promise.reject(new Error('não chega aqui')));
    const res = await app.request(PATH, { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
  });
});
