import { InternalApiError, type SquadGameField } from '@goodbot/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const GUILD_ID = '100000000000000000';
const ACTOR = '200000000000000000';
const ANA = '300000000000000001';
const BIA = '300000000000000002';
const GAME = '11111111-1111-4111-8111-111111111111';
const SQUAD = '33333333-3333-4333-8333-333333333333';

const setSquadProfileStatus = vi.fn();
const editSquadProfileAnswers = vi.fn();
const deleteSquadProfile = vi.fn();
const removeSquadMember = vi.fn();
const checkSquadManualMatch = vi.fn();
const proposeSquadManually = vi.fn();
const getSquadGame = vi.fn();
const listSquadGames = vi.fn();
const updateSquadGame = vi.fn();
const syncSquadStatusesToGroupSize = vi.fn();
const withAudit = vi.fn();
const revalidatePath = vi.fn();

const BOT_CALLS = [
  setSquadProfileStatus,
  editSquadProfileAnswers,
  deleteSquadProfile,
  removeSquadMember,
  checkSquadManualMatch,
  proposeSquadManually,
];

/** O nível que `requireGuildAccess` vai conceder no teste da vez. */
let level: 'mod' | 'admin' = 'admin';

vi.mock('server-only', () => ({}));
vi.mock('@goodbot/db', () => ({
  countSearchingProfilesByGame: vi.fn(),
  createSquadGame: vi.fn(),
  deleteSquadGame: vi.fn(),
  getSquadGame: (...args: unknown[]) => getSquadGame(...args),
  listMembersOfSquads: vi.fn(),
  listOpenSquadProposals: vi.fn(),
  listOpenJoinRequests: vi.fn(),
  listRecentProposalPairs: vi.fn(),
  listSquadGames: (...args: unknown[]) => listSquadGames(...args),
  listSquadProfilesByGame: vi.fn(),
  listSquads: vi.fn(),
  syncSquadStatusesToGroupSize: (...args: unknown[]) => syncSquadStatusesToGroupSize(...args),
  updateSquadGame: (...args: unknown[]) => updateSquadGame(...args),
}));
vi.mock('./db', () => ({ db: () => ({}) }));
vi.mock('./audit', () => ({ withAudit: (...args: unknown[]) => withAudit(...args) }));
vi.mock('./discord', () => ({ loadMemberSummaries: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));
vi.mock('./internal-api', () => ({
  internalApi: () => ({
    setSquadProfileStatus,
    editSquadProfileAnswers,
    deleteSquadProfile,
    removeSquadMember,
    checkSquadManualMatch,
    proposeSquadManually,
  }),
}));
vi.mock('./auth/require', () => ({
  // O de verdade faz `redirect()`, que lança: a action nunca chega a escrever.
  requireGuildAccess: (_guildId: string, minimum: 'mod' | 'admin') => {
    if (minimum === 'admin' && level !== 'admin') throw new Error('NEXT_REDIRECT');
    return Promise.resolve({
      user: { id: ACTOR, name: 'admin#1', image: null },
      level,
      guildId: GUILD_ID,
    });
  },
}));

const {
  checkManualSquadMatch,
  deletePlayerProfile,
  editPlayerAnswers,
  proposeManualSquad,
  removePlayerFromSquad,
  saveSquadGame,
  setPlayerStatus,
} = await import('./squads');

function payload(body: Record<string, unknown>): FormData {
  const formData = new FormData();
  formData.set('payload', JSON.stringify(body));
  return formData;
}

const FIELDS: SquadGameField[] = [
  {
    key: 'plataforma',
    label: 'Plataforma',
    type: 'select',
    options: ['PC', 'PS5'],
    required: true,
    match: 'hard',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  level = 'admin';
  getSquadGame.mockResolvedValue({ id: GAME, fields: FIELDS });
});

describe('nível', () => {
  it('mod não revisa, não propõe e não mexe em jogador', async () => {
    level = 'mod';
    const body = payload({
      gameId: GAME,
      squadId: SQUAD,
      userId: ANA,
      userIds: [ANA, BIA],
      status: 'paused',
      answers: { plataforma: 'PC' },
      reason: 'sumiu',
    });

    await expect(setPlayerStatus(GUILD_ID, body)).rejects.toThrow('NEXT_REDIRECT');
    await expect(editPlayerAnswers(GUILD_ID, body)).rejects.toThrow('NEXT_REDIRECT');
    await expect(deletePlayerProfile(GUILD_ID, body)).rejects.toThrow('NEXT_REDIRECT');
    await expect(removePlayerFromSquad(GUILD_ID, body)).rejects.toThrow('NEXT_REDIRECT');
    await expect(checkManualSquadMatch(GUILD_ID, body)).rejects.toThrow('NEXT_REDIRECT');
    await expect(proposeManualSquad(GUILD_ID, body)).rejects.toThrow('NEXT_REDIRECT');

    for (const call of BOT_CALLS) expect(call).not.toHaveBeenCalled();
  });
});

describe('motivo', () => {
  it('em branco ou ausente volta marcado no campo e não chega ao bot', async () => {
    const results = [
      await setPlayerStatus(
        GUILD_ID,
        payload({ gameId: GAME, userId: ANA, status: 'paused', reason: '   ' }),
      ),
      await editPlayerAnswers(
        GUILD_ID,
        payload({ gameId: GAME, userId: ANA, answers: { plataforma: 'PC' }, reason: '' }),
      ),
      await deletePlayerProfile(GUILD_ID, payload({ gameId: GAME, userId: ANA })),
      await removePlayerFromSquad(
        GUILD_ID,
        payload({ squadId: SQUAD, userId: ANA, reason: '\n\t' }),
      ),
    ];

    for (const result of results) {
      expect(result.ok).toBe(false);
      expect(result.fieldErrors?.reason).toBeDefined();
    }
    for (const call of BOT_CALLS) expect(call).not.toHaveBeenCalled();
  });

  it('sai sem os espaços das pontas, e o actorId é o da sessão, nunca o do corpo', async () => {
    setSquadProfileStatus.mockResolvedValue({ notified: true });

    const result = await setPlayerStatus(
      GUILD_ID,
      payload({
        gameId: GAME,
        userId: ANA,
        status: 'paused',
        reason: '  Sumiu das sessões  ',
        actorId: BIA,
      }),
    );

    expect(setSquadProfileStatus).toHaveBeenCalledWith(GUILD_ID, GAME, ANA, {
      actorId: ACTOR,
      status: 'paused',
      reason: 'Sumiu das sessões',
    });
    expect(result).toEqual({
      ok: true,
      notified: true,
      message: 'Busca pausada e a pessoa foi avisada por DM.',
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/g/${GUILD_ID}/config/squads`);
    // O bot já grava a auditoria com origem `dashboard`.
    expect(withAudit).not.toHaveBeenCalled();
  });
});

describe('DM', () => {
  it('que não chegou vira a frase de não consegui avisar, e a ação continua valendo', async () => {
    setSquadProfileStatus.mockResolvedValue({ notified: false });
    removeSquadMember.mockResolvedValue({ notified: false });
    deleteSquadProfile.mockResolvedValue({ notified: false });
    const unreachable = 'mas não consegui avisar a pessoa por DM (DM fechada ou fora do servidor).';

    const resumed = await setPlayerStatus(
      GUILD_ID,
      payload({ gameId: GAME, userId: ANA, status: 'searching', reason: 'Voltou a jogar' }),
    );
    const removed = await removePlayerFromSquad(
      GUILD_ID,
      payload({ squadId: SQUAD, userId: ANA, reason: 'Faltou três sessões' }),
    );
    const deleted = await deletePlayerProfile(
      GUILD_ID,
      payload({ gameId: GAME, userId: ANA, reason: 'Perfil de teste' }),
    );

    expect(resumed).toEqual({ ok: true, notified: false, message: `Busca retomada, ${unreachable}` });
    expect(removed).toEqual({
      ok: true,
      notified: false,
      message: `Pessoa tirada do squad, ${unreachable}`,
    });
    expect(deleted).toEqual({ ok: true, notified: false, message: `Perfil apagado, ${unreachable}` });
    expect(removeSquadMember).toHaveBeenCalledWith(GUILD_ID, SQUAD, ANA, {
      actorId: ACTOR,
      reason: 'Faltou três sessões',
    });
    expect(deleteSquadProfile).toHaveBeenCalledWith(GUILD_ID, GAME, ANA, {
      actorId: ACTOR,
      reason: 'Perfil de teste',
    });
  });

  it('erro do bot vira a mensagem dele, sem recarregar a página', async () => {
    deleteSquadProfile.mockRejectedValue(
      new InternalApiError('Esta pessoa está numa proposta aberta deste jogo.', {
        status: 400,
        code: 'PROFILE_IN_PROPOSAL',
      }),
    );

    const result = await deletePlayerProfile(
      GUILD_ID,
      payload({ gameId: GAME, userId: ANA, reason: 'Perfil de teste' }),
    );

    expect(result).toEqual({
      ok: false,
      message: 'Esta pessoa está numa proposta aberta deste jogo.',
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('respostas', () => {
  it('obrigatório vazio volta no campo da resposta sem chamar o bot', async () => {
    const result = await editPlayerAnswers(
      GUILD_ID,
      payload({ gameId: GAME, userId: ANA, answers: { plataforma: '' }, reason: 'Corrigindo' }),
    );

    expect(result.ok).toBe(false);
    expect(result.fieldErrors).toHaveProperty(['answers.plataforma']);
    expect(editSquadProfileAnswers).not.toHaveBeenCalled();
  });

  it('chave que o jogo não tem é recusada', async () => {
    const result = await editPlayerAnswers(
      GUILD_ID,
      payload({
        gameId: GAME,
        userId: ANA,
        answers: { plataforma: 'PC', antiga: 'x' },
        reason: 'Corrigindo',
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.fieldErrors?.answers).toBeDefined();
    expect(editSquadProfileAnswers).not.toHaveBeenCalled();
  });

  it('jogo apagado não chega ao bot', async () => {
    getSquadGame.mockResolvedValue(null);

    const result = await editPlayerAnswers(
      GUILD_ID,
      payload({ gameId: GAME, userId: ANA, answers: { plataforma: 'PC' }, reason: 'Corrigindo' }),
    );

    expect(result).toEqual({ ok: false, message: 'Esse jogo não existe mais.' });
    expect(editSquadProfileAnswers).not.toHaveBeenCalled();
  });

  it('respostas válidas vão ao bot com o motivo', async () => {
    editSquadProfileAnswers.mockResolvedValue({ notified: true });

    const result = await editPlayerAnswers(
      GUILD_ID,
      payload({ gameId: GAME, userId: ANA, answers: { plataforma: 'PC' }, reason: 'Corrigindo' }),
    );

    expect(editSquadProfileAnswers).toHaveBeenCalledWith(GUILD_ID, GAME, ANA, {
      actorId: ACTOR,
      answers: { plataforma: 'PC' },
      reason: 'Corrigindo',
    });
    expect(result.message).toBe('Respostas salvas e a pessoa foi avisada por DM.');
  });
});

describe('match manual', () => {
  it('uma pessoa só não chega ao bot', async () => {
    const result = await checkManualSquadMatch(
      GUILD_ID,
      payload({ gameId: GAME, userIds: [ANA] }),
    );

    expect(result.ok).toBe(false);
    expect(checkSquadManualMatch).not.toHaveBeenCalled();
  });

  it('a revisão devolve o que o bot calculou', async () => {
    const check = { gameId: GAME, userIds: [ANA, BIA], pairs: [], score: 0, blocks: [], warnings: [] };
    checkSquadManualMatch.mockResolvedValue(check);

    const result = await checkManualSquadMatch(
      GUILD_ID,
      payload({ gameId: GAME, userIds: [ANA, BIA] }),
    );

    expect(result).toEqual({ ok: true, check });
    expect(checkSquadManualMatch).toHaveBeenCalledWith(GUILD_ID, GAME, {
      actorId: ACTOR,
      userIds: [ANA, BIA],
    });
  });

  it('manda as keys confirmadas e marca stale quando o bot acha aviso novo', async () => {
    proposeSquadManually.mockRejectedValue(
      new InternalApiError('Há avisos que não foram confirmados. Revise de novo.', {
        status: 409,
        code: 'MANUAL_MATCH_UNCONFIRMED',
      }),
    );

    const result = await proposeManualSquad(
      GUILD_ID,
      payload({ gameId: GAME, userIds: [ANA, BIA], confirmedWarnings: [`NOT_SEARCHING:${BIA}`] }),
    );

    expect(proposeSquadManually).toHaveBeenCalledWith(GUILD_ID, GAME, {
      actorId: ACTOR,
      userIds: [ANA, BIA],
      confirmedWarnings: [`NOT_SEARCHING:${BIA}`],
    });
    expect(result).toEqual({
      ok: false,
      message: 'Há avisos que não foram confirmados. Revise de novo.',
      stale: true,
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('bloqueio não é revisão velha: volta como erro comum', async () => {
    proposeSquadManually.mockRejectedValue(
      new InternalApiError('O grupo tem 1 bloqueio. Revise no painel.', {
        status: 422,
        code: 'MANUAL_MATCH_BLOCKED',
      }),
    );

    const result = await proposeManualSquad(
      GUILD_ID,
      payload({ gameId: GAME, userIds: [ANA, BIA] }),
    );

    expect(result).toEqual({ ok: false, message: 'O grupo tem 1 bloqueio. Revise no painel.' });
  });

  it('proposta aberta recarrega a página', async () => {
    proposeSquadManually.mockResolvedValue({});

    const result = await proposeManualSquad(
      GUILD_ID,
      payload({ gameId: GAME, userIds: [ANA, BIA], confirmedWarnings: [] }),
    );

    expect(result.ok).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith(`/g/${GUILD_ID}/config/squads`);
  });
});

describe('jogo', () => {
  const stored = {
    id: GAME,
    name: 'Helldivers 2',
    groupSize: 4,
    partySize: 4,
    enabled: true,
    fields: [],
  };

  function gameForm(sizes: { groupSize: number; partySize: number }): FormData {
    const formData = new FormData();
    formData.set('gameId', GAME);
    formData.set(
      'game',
      JSON.stringify({ name: 'Helldivers 2', enabled: true, fields: [], ...sizes }),
    );
    return formData;
  }

  beforeEach(() => {
    listSquadGames.mockResolvedValue([stored]);
    updateSquadGame.mockImplementation((_db, _guildId, _gameId, input: object) =>
      Promise.resolve({ ...stored, ...input }),
    );
  });

  it('party maior que o squad volta marcada no campo e não grava', async () => {
    const result = await saveSquadGame(GUILD_ID, gameForm({ groupSize: 3, partySize: 4 }));

    expect(result).toMatchObject({ ok: false, fieldErrors: { partySize: expect.any(String) } });
    expect(updateSquadGame).not.toHaveBeenCalled();
  });

  it('mudar o tamanho do grupo acerta a vaga dos squads vivos; mudar só a party não', async () => {
    expect((await saveSquadGame(GUILD_ID, gameForm({ groupSize: 12, partySize: 4 }))).ok).toBe(
      true,
    );
    expect(updateSquadGame).toHaveBeenCalledWith(
      {},
      GUILD_ID,
      GAME,
      expect.objectContaining({ groupSize: 12, partySize: 4 }),
    );
    expect(syncSquadStatusesToGroupSize).toHaveBeenCalledWith({}, GUILD_ID, GAME, 12);

    syncSquadStatusesToGroupSize.mockClear();
    expect((await saveSquadGame(GUILD_ID, gameForm({ groupSize: 4, partySize: 2 }))).ok).toBe(true);
    expect(syncSquadStatusesToGroupSize).not.toHaveBeenCalled();
  });
});
