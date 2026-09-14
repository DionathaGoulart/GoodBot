import { MemberLookupResultSchema } from '@goodbot/shared';
import { Collection } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS } from '../../services/config';
import { createApiApp } from '../server';

import type { ApiDeps } from '../context';

const TOKEN = 'a'.repeat(64);
const GUILD_ID = '100000000000000001';
const ANA = '300000000000000001';
const BIA = '300000000000000002';
const CAIO = '300000000000000003';

const auth = { authorization: `Bearer ${TOKEN}` };

/** Membro o bastante para `toMemberSummary`. */
function fakeMember(id: string, name: string) {
  return {
    id,
    displayName: name,
    user: { id, bot: false, username: name.toLowerCase() },
    displayAvatarURL: () => `https://cdn.example/${id}.png`,
    joinedAt: new Date(0),
    roles: { cache: new Collection<string, { id: string }>() },
  };
}

/** Ana no cache; o gateway conhece só a Bia. */
function scenario() {
  const fetch = vi.fn(
    async (options: { user: string[] }) =>
      new Collection(
        options.user.filter((id) => id === BIA).map((id) => [id, fakeMember(id, 'Bia')] as const),
      ),
  );
  const guild = {
    id: GUILD_ID,
    members: { cache: new Collection([[ANA, fakeMember(ANA, 'Ana')]]), fetch },
  };
  const deps = {
    client: { guilds: { cache: new Collection([[GUILD_ID, guild]]) } },
    config: { getSettings: vi.fn(async () => DEFAULT_SETTINGS) },
  } as unknown as ApiDeps;
  const app = createApiApp({
    deps,
    token: TOKEN,
    port: 0,
    admin: { discordToken: 'token', clientId: '500000000000000005' },
  });
  const lookup = (ids: string, headers: Record<string, string> = auth) =>
    app.request(`/guilds/${GUILD_ID}/members/lookup?ids=${ids}`, { headers });
  return { fetch, lookup };
}

describe('GET /guilds/:id/members/lookup', () => {
  it('sem Bearer não responde nada', async () => {
    const s = scenario();
    expect((await s.lookup(ANA, {})).status).toBe(401);
  });

  it('junta cache e gateway, e quem o gateway não devolveu está fora do servidor', async () => {
    const s = scenario();

    const res = await s.lookup(`${ANA},${BIA},${CAIO},${ANA}`);

    expect(res.status).toBe(200);
    const body = MemberLookupResultSchema.parse(await res.json());
    expect(body.members.map((member) => [member.id, member.displayName])).toEqual([
      [ANA, 'Ana'],
      [BIA, 'Bia'],
    ]);
    expect(body).toMatchObject({ missing: [CAIO], unresolved: [] });
    expect(s.fetch).toHaveBeenCalledTimes(1);
    expect(s.fetch).toHaveBeenCalledWith({ user: [BIA, CAIO] });
  });

  it('tudo no cache não toca o gateway', async () => {
    const s = scenario();

    const body = MemberLookupResultSchema.parse(await (await s.lookup(ANA)).json());

    expect(body.members.map((member) => member.id)).toEqual([ANA]);
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it('gateway que falha devolve os IDs pendentes em unresolved, não em missing', async () => {
    const s = scenario();
    s.fetch.mockRejectedValueOnce(new Error('Members didn’t arrive in time.'));

    const res = await s.lookup(`${ANA},${BIA},${CAIO}`);

    expect(res.status).toBe(200);
    expect(MemberLookupResultSchema.parse(await res.json())).toMatchObject({
      members: [expect.objectContaining({ id: ANA })],
      missing: [],
      unresolved: [BIA, CAIO],
    });
  });

  it('IDs inválidos ou ausentes são 400', async () => {
    const s = scenario();

    for (const ids of ['abc', '', `${ANA},123`]) {
      const res = await s.lookup(ids);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: 'VALIDATION' } });
    }
    expect(s.fetch).not.toHaveBeenCalled();
  });
});
