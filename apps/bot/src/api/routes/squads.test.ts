import {
  DeleteSquadProfileResultSchema,
  RemoveSquadMemberResultSchema,
  SquadManualCheckSchema,
  SquadManualProposalResultSchema,
  SquadOverviewSchema,
  SquadProfileAnswersResultSchema,
  SquadProfileStatusResultSchema,
  SquadSummarySchema,
  toBits,
} from '@goodbot/shared';
import { Collection, PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS } from '../../services/config';
import { fakeTextChannel, fakeThread } from '../../services/squads/__fixtures__/discord';
import { A, B, C, createHarness, D } from '../../services/squads/__fixtures__/harness';
import { createApiApp } from '../server';

import type { ApiDeps } from '../context';

const fixtures = await vi.hoisted(async () => import('../../services/squads/__fixtures__/fake-db'));
vi.mock('@goodbot/db', () => fixtures.repositories);

const { store, seedGame, seedMember, seedProfile, seedProposal, seedSquad, GUILD_ID } = fixtures;

const TOKEN = 'a'.repeat(64);
const ADMIN = '300000000000000010';
const MOD = '300000000000000011';
const OTHER_GUILD = '800000000000000000';
const SATURDAY_NIGHT = toBits([{ day: 6, block: 2 }]);

const auth = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
const post = (body: unknown) => ({ method: 'POST', headers: auth, body: JSON.stringify(body) });

/** Membro o bastante para `requireActor`: o nível sai das permissões. */
function fakeMember(id: string, permissions = 0n) {
  return {
    id,
    guild: { ownerId: '100000000000000999' },
    user: { bot: false },
    roles: { cache: new Collection(), highest: { position: 1 } },
    permissions: new PermissionsBitField(permissions),
  };
}

/** A API sobre o harness de squads, com um admin, um moderador e A como membro comum. */
function apiScenario() {
  const h = createHarness();
  const settings = { ...DEFAULT_SETTINGS };
  h.configService.getSettings.mockResolvedValue(settings);
  Object.assign(h.guild.members, {
    cache: new Collection([
      [ADMIN, fakeMember(ADMIN, PermissionFlagsBits.Administrator)],
      [MOD, fakeMember(MOD, PermissionFlagsBits.BanMembers)],
      [A, fakeMember(A)],
    ]),
    fetch: vi.fn(() => Promise.reject(new Error('Unknown Member'))),
  });

  const deps = {
    client: h.client,
    db: fixtures.fakeDb,
    config: h.configService,
    squads: h.service,
  } as unknown as ApiDeps;
  const app = createApiApp({
    deps,
    token: TOKEN,
    port: 0,
    admin: { discordToken: 'token', clientId: '500000000000000005' },
  });
  return { ...h, app };
}

/** Squad aberto de sábado à noite com A e B, já com canal de texto. */
function withSquad(s: ReturnType<typeof apiScenario>) {
  const game = seedGame();
  const channel = s.guild.add(fakeTextChannel({ name: 'squad-teste' }));
  const squad = seedSquad({ gameId: game.id, textChannelId: channel.id });
  seedMember(squad.id, A);
  seedMember(squad.id, B);
  return { game, channel, squad };
}

const squadUrl = (squadId: string, action: string) =>
  `/guilds/${GUILD_ID}/squads/${squadId}/${action}`;

describe('GET /guilds/:id/squads/overview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sem Bearer não responde nada', async () => {
    const s = apiScenario();
    expect((await s.app.request(`/guilds/${GUILD_ID}/squads/overview`)).status).toBe(401);
  });

  it('devolve jogos, squads vivos com membros, propostas abertas e contadores', async () => {
    const s = apiScenario();
    const { game, squad } = withSquad(s);
    seedSquad({ gameId: game.id, name: 'Arquivado', status: 'archived' });
    seedProposal({ gameId: game.id, userIds: [C, ADMIN], threadId: s.guild.add(fakeThread()).id });
    seedProposal({
      gameId: game.id,
      userIds: [A, B],
      threadId: '600000000000009999',
      closedAt: new Date(),
    });
    seedProfile({ userId: C, gameId: game.id, availability: SATURDAY_NIGHT });
    seedProfile({ userId: ADMIN, gameId: game.id, availability: SATURDAY_NIGHT });
    seedProfile({ userId: A, gameId: game.id, status: 'in_squad' });
    // De outra guild: nada disto pode aparecer.
    seedSquad({ gameId: game.id, guildId: OTHER_GUILD });
    seedProfile({ userId: B, gameId: game.id, guildId: OTHER_GUILD, availability: SATURDAY_NIGHT });

    const res = await s.app.request(`/guilds/${GUILD_ID}/squads/overview`, { headers: auth });

    expect(res.status).toBe(200);
    const overview = SquadOverviewSchema.parse(await res.json());
    expect(
      overview.games.map(({ id, groupSize, partySize }) => ({ id, groupSize, partySize })),
    ).toEqual([{ id: game.id, groupSize: 4, partySize: 4 }]);
    expect(overview.squads).toEqual([
      expect.objectContaining({ id: squad.id, memberIds: [A, B], status: 'open' }),
    ]);
    expect(overview.openProposals.map((proposal) => proposal.userIds)).toEqual([[C, ADMIN]]);
    expect(overview.searchingCount).toEqual({ [game.id]: 2 });
    // Categoria, canal de busca, dois voices e o canal do squad; a thread não conta.
    expect(overview.channels).toEqual({ used: 5, limit: 500 });
  });
});

describe('POST /guilds/:id/squads/:squadId/archive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('membro comum não arquiva', async () => {
    const s = apiScenario();
    const { squad } = withSquad(s);

    const res = await s.app.request(squadUrl(squad.id, 'archive'), post({ actorId: A }));

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: 'ACTOR_NOT_MOD' } });
    expect(store.squads[0]?.status).toBe('open');
  });

  it('moderador arquiva com o módulo desligado e recebe o squad atualizado', async () => {
    const s = apiScenario();
    s.setConfig({ enabled: false });
    const { squad, channel } = withSquad(s);

    const res = await s.app.request(
      squadUrl(squad.id, 'archive'),
      post({ actorId: MOD, reason: 'Parado há meses' }),
    );

    expect(res.status).toBe(200);
    expect(SquadSummarySchema.parse(await res.json())).toMatchObject({
      id: squad.id,
      status: 'archived',
      memberIds: [A, B],
    });
    expect(channel.send).toHaveBeenCalled();
    expect(s.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'squad.archive', source: 'dashboard', actor: MOD }),
    );
  });

  it('squad de outra guild é 404, e id que não é uuid é 400', async () => {
    const s = apiScenario();
    const foreign = seedSquad({ gameId: seedGame().id, guildId: OTHER_GUILD });

    const missing = await s.app.request(squadUrl(foreign.id, 'archive'), post({ actorId: MOD }));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: { code: 'SQUAD_NOT_FOUND' } });
    expect(store.squads[0]?.status).toBe('open');

    const invalid = await s.app.request(squadUrl('nao-e-uuid', 'archive'), post({ actorId: MOD }));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { code: 'VALIDATION' } });
  });

  it('arquivar de novo avisa que já foi', async () => {
    const s = apiScenario();
    const { squad } = withSquad(s);
    await s.app.request(squadUrl(squad.id, 'archive'), post({ actorId: MOD }));

    const again = await s.app.request(squadUrl(squad.id, 'archive'), post({ actorId: MOD }));

    expect(again.status).toBe(400);
    expect(await again.json()).toMatchObject({ error: { code: 'SQUAD_ARCHIVED' } });
  });
});

describe('POST /guilds/:id/squads/:squadId/rename', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('moderador renomeia o squad e o canal sem ser membro', async () => {
    const s = apiScenario();
    const { squad, channel } = withSquad(s);

    const res = await s.app.request(
      squadUrl(squad.id, 'rename'),
      post({ actorId: MOD, name: 'Os Destemidos' }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: squad.id, name: 'Os Destemidos' });
    expect(channel.setName).toHaveBeenCalled();
  });

  it('nome vazio é recusado antes de tocar no banco', async () => {
    const s = apiScenario();
    const { squad } = withSquad(s);

    const res = await s.app.request(
      squadUrl(squad.id, 'rename'),
      post({ actorId: MOD, name: ' ' }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'VALIDATION' } });
    expect(store.squads[0]?.name).toBe('Squad Teste');
  });
});

describe('POST /guilds/:id/squads/search-message', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('só admin publica', async () => {
    const s = apiScenario();
    seedGame();

    const res = await s.app.request(
      `/guilds/${GUILD_ID}/squads/search-message`,
      post({ actorId: MOD }),
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: 'ACTOR_NOT_ADMIN' } });
    expect(s.search.send).not.toHaveBeenCalled();
  });

  it('admin publica no canal de busca do config', async () => {
    const s = apiScenario();
    seedGame();

    const res = await s.app.request(
      `/guilds/${GUILD_ID}/squads/search-message`,
      post({ actorId: ADMIN }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ channelId: s.search.id, messageId: s.search.sent[0]?.id });
    expect(s.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'squad.search_message.publish', source: 'dashboard' }),
    );
  });
});

describe('POST /guilds/:id/squads/games/:gameId/match', () => {
  const matchUrl = (gameId: string) => `/guilds/${GUILD_ID}/squads/games/${gameId}/match`;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('admin roda o match e recebe quantas propostas saíram', async () => {
    const s = apiScenario();
    const game = seedGame({ groupSize: 3, partySize: 3 });
    for (const userId of [A, B]) {
      seedProfile({ userId, gameId: game.id, availability: SATURDAY_NIGHT });
    }

    const res = await s.app.request(matchUrl(game.id), post({ actorId: ADMIN }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ proposals: 1, joinRequests: 0 });
  });

  it('diz por que não rodou: jogo de outra guild, jogo desligado, módulo desligado', async () => {
    const s = apiScenario();
    const foreign = seedGame({ guildId: OTHER_GUILD });
    const off = seedGame({ name: 'Desligado', enabled: false });

    const missing = await s.app.request(matchUrl(foreign.id), post({ actorId: ADMIN }));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: { code: 'GAME_NOT_FOUND' } });

    const gameOff = await s.app.request(matchUrl(off.id), post({ actorId: ADMIN }));
    expect(gameOff.status).toBe(400);
    expect(await gameOff.json()).toMatchObject({ error: { code: 'GAME_DISABLED' } });

    s.setConfig({ enabled: false });
    const moduleOff = await s.app.request(matchUrl(off.id), post({ actorId: ADMIN }));
    expect(moduleOff.status).toBe(400);
    expect(await moduleOff.json()).toMatchObject({ error: { code: 'MODULE_DISABLED' } });
    expect(s.search.threads.create).not.toHaveBeenCalled();
  });
});

describe('POST /guilds/:id/squads/games/:gameId/manual/check', () => {
  const checkUrl = (gameId: string) => `/guilds/${GUILD_ID}/squads/games/${gameId}/manual/check`;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('só admin revisa, jogo de outra guild é 404 e a turma precisa de duas pessoas distintas', async () => {
    const s = apiScenario();
    const game = seedGame();
    const foreign = seedGame({ guildId: OTHER_GUILD });

    const asMod = await s.app.request(checkUrl(game.id), post({ actorId: MOD, userIds: [A, B] }));
    expect(asMod.status).toBe(403);
    expect(await asMod.json()).toMatchObject({ error: { code: 'ACTOR_NOT_ADMIN' } });

    const missing = await s.app.request(
      checkUrl(foreign.id),
      post({ actorId: ADMIN, userIds: [A, B] }),
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: { code: 'GAME_NOT_FOUND' } });

    for (const userIds of [[A, A], [A]]) {
      const invalid = await s.app.request(checkUrl(game.id), post({ actorId: ADMIN, userIds }));
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toMatchObject({ error: { code: 'VALIDATION' } });
    }
  });

  it('admin recebe a revisão no formato do schema, sem nada escrito', async () => {
    const s = apiScenario();
    const game = seedGame();
    for (const userId of [A, B]) {
      seedProfile({ userId, gameId: game.id, availability: SATURDAY_NIGHT });
    }

    const res = await s.app.request(checkUrl(game.id), post({ actorId: ADMIN, userIds: [B, A] }));

    expect(res.status).toBe(200);
    expect(SquadManualCheckSchema.parse(await res.json())).toMatchObject({
      gameId: game.id,
      userIds: [A, B],
      slot: { day: 6, block: 2 },
      blocks: [],
      warnings: [],
    });
    expect(store.proposals).toHaveLength(0);
  });
});

describe('POST /guilds/:id/squads/games/:gameId/manual/propose', () => {
  const proposeUrl = (gameId: string) =>
    `/guilds/${GUILD_ID}/squads/games/${gameId}/manual/propose`;

  function withProfiles(s: ReturnType<typeof apiScenario>, paused: string[] = []) {
    const game = seedGame();
    for (const userId of [A, B]) {
      seedProfile({
        userId,
        gameId: game.id,
        availability: SATURDAY_NIGHT,
        status: paused.includes(userId) ? 'paused' : 'searching',
      });
    }
    return game;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('bloqueio é 422 e aviso sem confirmação é 409', async () => {
    const s = apiScenario();
    const game = withProfiles(s, [A]);

    const blocked = await s.app.request(
      proposeUrl(game.id),
      post({ actorId: ADMIN, userIds: [A, C] }),
    );
    expect(blocked.status).toBe(422);
    expect(await blocked.json()).toMatchObject({ error: { code: 'MANUAL_MATCH_BLOCKED' } });

    const unconfirmed = await s.app.request(
      proposeUrl(game.id),
      post({ actorId: ADMIN, userIds: [A, B] }),
    );
    expect(unconfirmed.status).toBe(409);
    expect(await unconfirmed.json()).toMatchObject({ error: { code: 'MANUAL_MATCH_UNCONFIRMED' } });
    expect(s.search.threads.create).not.toHaveBeenCalled();
  });

  it('com os avisos confirmados abre a proposta e devolve a revisão', async () => {
    const s = apiScenario();
    const game = withProfiles(s, [A]);

    const res = await s.app.request(
      proposeUrl(game.id),
      post({ actorId: ADMIN, userIds: [A, B], confirmedWarnings: [`NOT_SEARCHING:${A}`] }),
    );

    expect(res.status).toBe(200);
    const body = SquadManualProposalResultSchema.parse(await res.json());
    expect(body.proposal.userIds).toEqual([A, B]);
    expect(body.check.warnings.map((warning) => warning.key)).toEqual([`NOT_SEARCHING:${A}`]);
    expect(s.search.threads.create).toHaveBeenCalledTimes(1);
  });

  it('sem canal de busca é 400', async () => {
    const s = apiScenario();
    const game = withProfiles(s);
    s.setConfig({ searchChannelId: null });

    const res = await s.app.request(proposeUrl(game.id), post({ actorId: ADMIN, userIds: [A, B] }));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'SQUADS_NO_SEARCH_CHANNEL' } });
  });
});

describe('rotas de gestão de jogadores', () => {
  const REASON = 'Sumiu das sessões há três semanas.';

  /** A e B no squad; A com perfil `in_squad`, C procurando; jogo e squad de outra guild. */
  function setup() {
    const s = apiScenario();
    const { game, squad, channel } = withSquad(s);
    seedProfile({ userId: A, gameId: game.id, availability: SATURDAY_NIGHT, status: 'in_squad' });
    seedProfile({ userId: C, gameId: game.id, availability: SATURDAY_NIGHT });
    const foreignGame = seedGame({ guildId: OTHER_GUILD });
    const foreignSquad = seedSquad({ gameId: foreignGame.id, guildId: OTHER_GUILD });
    return { ...s, game, squad, channel, foreignGame, foreignSquad };
  }
  type Setup = ReturnType<typeof setup>;

  interface RouteCase {
    name: string;
    url: (x: Setup, userId?: string) => string;
    foreignUrl: (x: Setup) => string;
    foreignCode: string;
    body: Record<string, unknown>;
    schema: { parse: (value: unknown) => { notified: boolean } };
    target: string;
  }

  const profileUrl = (gameId: string, userId: string, action: string) =>
    `/guilds/${GUILD_ID}/squads/games/${gameId}/profiles/${userId}/${action}`;

  const routes: RouteCase[] = [
    {
      name: 'status',
      url: (x, userId = C) => profileUrl(x.game.id, userId, 'status'),
      foreignUrl: (x) => profileUrl(x.foreignGame.id, C, 'status'),
      foreignCode: 'GAME_NOT_FOUND',
      body: { status: 'paused' },
      schema: SquadProfileStatusResultSchema,
      target: C,
    },
    {
      name: 'answers',
      url: (x, userId = C) => profileUrl(x.game.id, userId, 'answers'),
      foreignUrl: (x) => profileUrl(x.foreignGame.id, C, 'answers'),
      foreignCode: 'GAME_NOT_FOUND',
      body: { answers: { platform: 'PS5' } },
      schema: SquadProfileAnswersResultSchema,
      target: C,
    },
    {
      name: 'delete',
      url: (x, userId = C) => profileUrl(x.game.id, userId, 'delete'),
      foreignUrl: (x) => profileUrl(x.foreignGame.id, C, 'delete'),
      foreignCode: 'GAME_NOT_FOUND',
      body: {},
      schema: DeleteSquadProfileResultSchema,
      target: C,
    },
    {
      name: 'remove',
      url: (x, userId = A) => squadUrl(x.squad.id, `members/${userId}/remove`),
      foreignUrl: (x) => squadUrl(x.foreignSquad.id, `members/${A}/remove`),
      foreignCode: 'SQUAD_NOT_FOUND',
      body: {},
      schema: RemoveSquadMemberResultSchema,
      target: A,
    },
  ];

  describe.each(routes)('POST $name', (route) => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('só admin, recurso de outra guild é 404 e userId inválido é 400', async () => {
      const x = setup();
      const body = (actorId: string) => post({ ...route.body, actorId, reason: REASON });

      const asMod = await x.app.request(route.url(x), body(MOD));
      expect(asMod.status).toBe(403);
      expect(await asMod.json()).toMatchObject({ error: { code: 'ACTOR_NOT_ADMIN' } });

      const foreign = await x.app.request(route.foreignUrl(x), body(ADMIN));
      expect(foreign.status).toBe(404);
      expect(await foreign.json()).toMatchObject({ error: { code: route.foreignCode } });

      const invalid = await x.app.request(route.url(x, 'abc'), body(ADMIN));
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toMatchObject({ error: { code: 'VALIDATION' } });
      expect(x.users.fetch).not.toHaveBeenCalled();
    });

    it('sem motivo ou com motivo em branco é 400', async () => {
      const x = setup();

      for (const reason of [undefined, '', '   ']) {
        const res = await x.app.request(
          route.url(x),
          post({ ...route.body, actorId: ADMIN, ...(reason === undefined ? {} : { reason }) }),
        );
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: { code: 'VALIDATION' } });
      }
      expect(x.users.fetch).not.toHaveBeenCalled();
    });

    it('admin recebe 200 com notified true; com a DM fechada, notified false', async () => {
      const x = setup();
      const ok = await x.app.request(
        route.url(x),
        post({ ...route.body, actorId: ADMIN, reason: REASON }),
      );
      expect(ok.status).toBe(200);
      expect(route.schema.parse(await ok.json())).toMatchObject({ notified: true });
      expect(x.users.dmsOf(route.target)).toHaveLength(1);

      const y = setup();
      y.users.closeDms(route.target);
      const closed = await y.app.request(
        route.url(y),
        post({ ...route.body, actorId: ADMIN, reason: REASON }),
      );
      expect(closed.status).toBe(200);
      expect(route.schema.parse(await closed.json())).toMatchObject({ notified: false });
    });
  });

  it('perfil que não existe é 404', async () => {
    const x = setup();

    const res = await x.app.request(
      profileUrl(x.game.id, D, 'status'),
      post({ actorId: ADMIN, status: 'paused', reason: REASON }),
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'PROFILE_NOT_FOUND' } });
  });
});
