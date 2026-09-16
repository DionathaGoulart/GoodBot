import 'server-only';

import {
  countSearchingProfilesByGame,
  createSquadGame,
  deleteSquadGame,
  getSquadGame,
  listMembersOfSquads,
  listOpenSquadProposals,
  listOpenJoinRequests,
  listRecentProposalPairs,
  listSquadGames,
  listSquadProfilesByGame,
  listSquads,
  syncSquadStatusesToGroupSize,
  updateSquadGame,
} from '@goodbot/db';
import {
  DAY_MS,
  DeleteSquadProfileInputSchema,
  EditSquadProfileAnswersInputSchema,
  InternalApiError,
  ProposeSquadManuallyInputSchema,
  RemoveSquadMemberInputSchema,
  SetSquadProfileStatusInputSchema,
  SquadGameInputSchema,
  SquadManualCheckInputSchema,
  SquadNameSchema,
  validateAnswers,
  type SquadChannelUsage,
  type SquadGameInput,
  type SquadManualCheck,
  type SquadProposalSummary,
  type SquadsConfig,
  type SquadSummary,
} from '@goodbot/shared';
import { revalidatePath } from 'next/cache';

import { failure } from './action-error';
import { withAudit, type AuditActor } from './audit';
import { requireGuildAccess } from './auth/require';
import { db } from './db';
import { loadMemberSummaries } from './discord';
import { internalApi } from './internal-api';
import { toFieldErrors, type ActionResult } from './module-config';
import { formatMatchResult } from './squad-labels';

import type { SquadPlayersData } from './squad-players';
import type { z } from 'zod';

const PATH = (guildId: string) => `/g/${guildId}/config/squads`;

export type SquadGameRow = SquadGameInput & {
  id: string;
};

/** O que vem do bot. Fora do ar, as listas vêm vazias e o motivo sobe. */
export interface SquadsOverviewData {
  squads: SquadSummary[];
  openProposals: SquadProposalSummary[];
  /** `null` com o bot fora do ar: o contador sai do cache do gateway. */
  channels: SquadChannelUsage | null;
  error: string | null;
  /** Quando o painel leu: é o "agora" das datas relativas, igual no servidor e no navegador. */
  loadedAt: number;
}

/** Jogos vêm do banco: a aba JOGOS funciona com o bot fora do ar. */
export async function loadSquadGames(guildId: string): Promise<SquadGameRow[]> {
  const rows = await listSquadGames(db(), guildId);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    groupSize: row.groupSize,
    partySize: row.partySize,
    enabled: row.enabled,
    fields: row.fields,
  }));
}

/**
 * Squads, propostas e o contador de canais vêm do bot, que é quem enxerga os
 * canais reais da guild (o teto de 500 é do servidor inteiro).
 */
export async function loadSquadsOverview(guildId: string): Promise<SquadsOverviewData> {
  const loadedAt = Date.now();
  try {
    const overview = await internalApi().squadsOverview(guildId);
    return {
      squads: overview.squads,
      openProposals: overview.openProposals,
      channels: overview.channels,
      error: null,
      loadedAt,
    };
  } catch (error) {
    return {
      squads: [],
      openProposals: [],
      channels: null,
      loadedAt,
      error:
        error instanceof InternalApiError
          ? `O bot não respondeu: ${error.message}`
          : 'O bot não respondeu.',
    };
  }
}

/** `gameId → perfis procurando`, direto do banco: cabeçalho e aba JOGOS, em qualquer nível. */
export async function loadSearchingCounts(guildId: string): Promise<Record<string, number>> {
  return countSearchingProfilesByGame(db(), guildId);
}

/**
 * A aba JOGADORES, só para admin: perfis de todos os status, propostas,
 * squads vivos, pedidos e duplas em cooldown vêm do banco; nome e avatar, do
 * bot. Uma consulta de perfis e de cooldown por jogo (a guild tem poucos). Com
 * o bot fora do ar os nomes caem para o ID e o resto continua funcionando.
 */
export async function loadSquadPlayers(
  guildId: string,
  games: readonly Pick<SquadGameRow, 'id'>[],
  config: Pick<SquadsConfig, 'reproposeCooldownDays'>,
): Promise<SquadPlayersData> {
  const since = new Date(Date.now() - config.reproposeCooldownDays * DAY_MS);
  const [perGame, proposals, squads, requests, pairsPerGame] = await Promise.all([
    Promise.all(games.map((game) => listSquadProfilesByGame(db(), guildId, game.id))),
    listOpenSquadProposals(db(), guildId),
    listSquads(db(), guildId, { statuses: ['open', 'full'] }),
    listOpenJoinRequests(db(), guildId),
    Promise.all(games.map((game) => listRecentProposalPairs(db(), guildId, game.id, since))),
  ]);
  const profiles = perGame.flat();
  const [members, summaries] = await Promise.all([
    listMembersOfSquads(
      db(),
      guildId,
      squads.map((squad) => squad.id),
    ),
    loadMemberSummaries(
      guildId,
      profiles.map((profile) => profile.userId),
    ),
  ]);

  const memberIds = new Map<string, string[]>();
  for (const member of members) {
    memberIds.set(member.squadId, [...(memberIds.get(member.squadId) ?? []), member.userId]);
  }

  return {
    profiles: profiles.map((row) => ({
      userId: row.userId,
      gameId: row.gameId,
      status: row.status,
      availability: row.availability,
      answers: row.answers,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      lastMatchedAt: row.lastMatchedAt?.toISOString() ?? null,
    })),
    openProposals: proposals.map((row) => ({
      id: row.id,
      gameId: row.gameId,
      userIds: row.userIds,
      acceptedIds: row.acceptedIds,
      declinedIds: row.declinedIds,
      squadId: row.squadId,
      threadId: row.threadId,
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    })),
    liveSquads: squads.flatMap((row) =>
      row.status === 'archived'
        ? []
        : [
            {
              id: row.id,
              gameId: row.gameId,
              name: row.name,
              status: row.status,
              textChannelId: row.textChannelId,
              memberIds: memberIds.get(row.id) ?? [],
            },
          ],
    ),
    pendingRequests: requests.map((row) => ({
      id: row.id,
      squadId: row.squadId,
      userId: row.userId,
      // A consulta só traz abertos: o que não é convite está em votação.
      status: row.status === 'invited' ? ('invited' as const) : ('pending' as const),
      createdAt: row.createdAt.toISOString(),
    })),
    cooldownPairs: Object.fromEntries(
      games.map((game, index) => [game.id, pairsPerGame[index] ?? []]),
    ),
    members: summaries.members,
    missingMemberIds: summaries.missing,
    unresolvedMemberIds: summaries.unresolved,
    membersError: summaries.error,
  };
}

function parseBody(raw: FormDataEntryValue | null): unknown {
  if (typeof raw !== 'string') return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function idFrom(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function actorOf(session: Awaited<ReturnType<typeof requireGuildAccess>>): AuditActor {
  return { id: session.user.id, tag: session.user.name, guildId: session.guildId };
}

// ── jogos ───────────────────────────────────────────────────────────────────

/**
 * Jogo é escrito direto no banco, como os tipos de ticket. O bot lê os jogos
 * sem cache, então não há o que invalidar; a mensagem fixa só muda quando
 * alguém a atualiza, e o toast da sheet lembra disso.
 */
export async function saveSquadGame(guildId: string, formData: FormData): Promise<ActionResult> {
  const session = await requireGuildAccess(guildId, 'admin');

  const parsed = SquadGameInputSchema.safeParse(parseBody(formData.get('game')));
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Confira os campos marcados.',
      fieldErrors: toFieldErrors(parsed.error),
    };
  }
  const input = parsed.data;
  const gameId = idFrom(formData, 'gameId');

  const games = await listSquadGames(db(), guildId);
  const before = gameId ? (games.find((game) => game.id === gameId) ?? null) : null;
  if (gameId && !before) return { ok: false, message: 'Esse jogo não existe mais.' };
  // Na edição o nome repetido estouraria o índice único como erro 500;
  // conferindo antes, o campo volta marcado.
  if (games.some((game) => game.name === input.name && game.id !== gameId)) {
    return {
      ok: false,
      message: 'Já existe um jogo com esse nome.',
      fieldErrors: { name: 'Nome em uso' },
    };
  }

  const saved = gameId
    ? await updateSquadGame(db(), guildId, gameId, input)
    : await createSquadGame(db(), { guildId, ...input });
  if (!saved) {
    return gameId
      ? { ok: false, message: 'Esse jogo não existe mais.' }
      : {
          ok: false,
          message: 'Já existe um jogo com esse nome.',
          fieldErrors: { name: 'Nome em uso' },
        };
  }

  // O status do squad só muda quando alguém entra ou sai. Sem acertar os vivos,
  // subir o grupo deixaria os squads que já estavam cheios fora da busca.
  if (before && before.groupSize !== saved.groupSize) {
    await syncSquadStatusesToGroupSize(db(), guildId, saved.id, saved.groupSize);
  }

  await withAudit(
    actorOf(session),
    gameId ? 'squad.game.update' : 'squad.game.create',
    { type: 'squad_game', id: saved.id },
    before,
    saved,
  );
  revalidatePath(PATH(guildId));
  return { ok: true };
}

/**
 * Apagar leva perfis, squads, propostas e sessões em cascata, mas os canais
 * no Discord ficam. Por isso squad vivo precisa ser arquivado antes, pelo bot,
 * que tranca o canal e devolve o voice.
 */
export async function removeSquadGame(guildId: string, formData: FormData): Promise<ActionResult> {
  const session = await requireGuildAccess(guildId, 'admin');

  const gameId = idFrom(formData, 'gameId');
  if (!gameId) return { ok: false, message: 'Jogo inválido.' };

  const active = await listSquads(db(), guildId, { gameId, statuses: ['open', 'full'] });
  if (active.length > 0) {
    return {
      ok: false,
      message:
        active.length === 1
          ? 'Arquive o squad deste jogo antes de apagá-lo.'
          : `Arquive os ${String(active.length)} squads deste jogo antes de apagá-lo.`,
    };
  }

  const removed = await deleteSquadGame(db(), guildId, gameId);
  if (!removed) return { ok: false, message: 'Esse jogo não existe mais.' };

  await withAudit(
    actorOf(session),
    'squad.game.delete',
    { type: 'squad_game', id: gameId },
    removed,
    null,
  );
  revalidatePath(PATH(guildId));
  return { ok: true };
}

// ── ações que passam pelo bot ───────────────────────────────────────────────
// Arquivar, renomear, publicar, o match manual e a gestão de jogadores já
// entram na auditoria pelo bot, com origem `dashboard`; gravar aqui também
// duplicaria a linha. O match automático não: o bot não registra, então o
// painel registra.

export async function publishSquadSearchMessage(guildId: string): Promise<ActionResult> {
  const session = await requireGuildAccess(guildId, 'admin');

  try {
    await internalApi().postSquadSearchMessage(guildId, { actorId: session.user.id });
  } catch (error) {
    return failure(error);
  }

  revalidatePath(PATH(guildId));
  return { ok: true, message: 'Mensagem de busca no ar.' };
}

export async function runSquadMatch(guildId: string, formData: FormData): Promise<ActionResult> {
  const session = await requireGuildAccess(guildId, 'admin');

  const gameId = idFrom(formData, 'gameId');
  if (!gameId) return { ok: false, message: 'Jogo inválido.' };

  let result;
  try {
    result = await internalApi().runSquadMatch(guildId, gameId, { actorId: session.user.id });
  } catch (error) {
    return failure(error);
  }

  await withAudit(
    actorOf(session),
    'squad.match.run',
    { type: 'squad_game', id: gameId },
    null,
    result,
  );
  revalidatePath(PATH(guildId));
  return { ok: true, message: formatMatchResult(result) };
}

export async function archiveSquad(guildId: string, formData: FormData): Promise<ActionResult> {
  const session = await requireGuildAccess(guildId, 'mod');

  const squadId = idFrom(formData, 'squadId');
  if (!squadId) return { ok: false, message: 'Squad inválido.' };

  try {
    await internalApi().archiveSquad(guildId, squadId, { actorId: session.user.id, reason: null });
  } catch (error) {
    return failure(error);
  }

  revalidatePath(PATH(guildId));
  return { ok: true, message: 'Squad arquivado. O canal ficou só para leitura.' };
}

export async function renameSquad(guildId: string, formData: FormData): Promise<ActionResult> {
  const session = await requireGuildAccess(guildId, 'mod');

  const squadId = idFrom(formData, 'squadId');
  if (!squadId) return { ok: false, message: 'Squad inválido.' };

  const parsed = SquadNameSchema.safeParse(formData.get('name'));
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? 'Nome inválido.';
    return { ok: false, message, fieldErrors: { name: message } };
  }

  try {
    await internalApi().renameSquad(guildId, squadId, {
      actorId: session.user.id,
      name: parsed.data,
    });
  } catch (error) {
    return failure(error);
  }

  revalidatePath(PATH(guildId));
  return {
    ok: true,
    message: 'Nome trocado. O canal pode levar alguns minutos: o Discord limita renomear canal.',
  };
}

// ── jogadores: match manual e gestão ────────────────────────────────────────

/** Resultado das ações que mandam DM: `notified` diz se a pessoa foi avisada. */
export type PlayerActionResult = ActionResult & { notified?: boolean };

export type ManualCheckResult =
  | { ok: true; check: SquadManualCheck }
  | { ok: false; message: string };

/** O corpo das ações de jogador: um JSON no campo `payload`. */
function payloadOf(formData: FormData): Record<string, unknown> {
  const raw = parseBody(formData.get('payload'));
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

const textOf = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

/** Erro de validação no molde do painel: a primeira mensagem no toast, cada campo marcado. */
function invalid(error: z.ZodError): ActionResult {
  return {
    ok: false,
    message: error.issues[0]?.message ?? 'Confira os campos marcados.',
    fieldErrors: toFieldErrors(error),
  };
}

/** A frase do toast, no molde de `punishMember`: a ação valeu, com ou sem a DM. */
function notifiedMessage(done: string, notified: boolean): string {
  return notified
    ? `${done} e a pessoa foi avisada por DM.`
    : `${done}, mas não consegui avisar a pessoa por DM (DM fechada ou fora do servidor).`;
}

/** Revisão da turma marcada: o bot confere com linhas frescas e quem saiu do servidor. */
export async function checkManualSquadMatch(
  guildId: string,
  formData: FormData,
): Promise<ManualCheckResult> {
  const session = await requireGuildAccess(guildId, 'admin');

  const payload = payloadOf(formData);
  const gameId = textOf(payload.gameId);
  if (!gameId) return { ok: false, message: 'Jogo inválido.' };
  const parsed = SquadManualCheckInputSchema.safeParse({
    actorId: session.user.id,
    userIds: payload.userIds,
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Seleção inválida.' };
  }

  try {
    return { ok: true, check: await internalApi().checkSquadManualMatch(guildId, gameId, parsed.data) };
  } catch (error) {
    return { ok: false, message: failure(error).message ?? 'O bot não respondeu.' };
  }
}

/**
 * Abre a proposta com a turma. `stale` quando o bot recalculou e achou aviso
 * que o admin não confirmou: a situação mudou desde a revisão, e o diálogo
 * precisa mostrar de novo.
 */
export async function proposeManualSquad(
  guildId: string,
  formData: FormData,
): Promise<ActionResult & { stale?: boolean }> {
  const session = await requireGuildAccess(guildId, 'admin');

  const payload = payloadOf(formData);
  const gameId = textOf(payload.gameId);
  if (!gameId) return { ok: false, message: 'Jogo inválido.' };
  const parsed = ProposeSquadManuallyInputSchema.safeParse({
    actorId: session.user.id,
    userIds: payload.userIds,
    confirmedWarnings: payload.confirmedWarnings,
  });
  if (!parsed.success) return invalid(parsed.error);

  try {
    await internalApi().proposeSquadManually(guildId, gameId, parsed.data);
  } catch (error) {
    if (error instanceof InternalApiError && error.code === 'MANUAL_MATCH_UNCONFIRMED') {
      return { ...failure(error), stale: true };
    }
    return failure(error);
  }

  revalidatePath(PATH(guildId));
  return {
    ok: true,
    message: 'Proposta aberta numa thread privada do canal de busca. Ninguém entra em squad sem aceitar.',
  };
}

export async function setPlayerStatus(
  guildId: string,
  formData: FormData,
): Promise<PlayerActionResult> {
  const session = await requireGuildAccess(guildId, 'admin');

  const payload = payloadOf(formData);
  const gameId = textOf(payload.gameId);
  const userId = textOf(payload.userId);
  if (!gameId || !userId) return { ok: false, message: 'Jogador inválido.' };
  const parsed = SetSquadProfileStatusInputSchema.safeParse({
    actorId: session.user.id,
    status: payload.status,
    reason: payload.reason,
  });
  if (!parsed.success) return invalid(parsed.error);

  let result;
  try {
    result = await internalApi().setSquadProfileStatus(guildId, gameId, userId, parsed.data);
  } catch (error) {
    return failure(error);
  }

  revalidatePath(PATH(guildId));
  const done = parsed.data.status === 'paused' ? 'Busca pausada' : 'Busca retomada';
  return { ok: true, notified: result.notified, message: notifiedMessage(done, result.notified) };
}

/** Respostas conferidas aqui contra os campos atuais, para o formulário marcar o campo. */
export async function editPlayerAnswers(
  guildId: string,
  formData: FormData,
): Promise<PlayerActionResult> {
  const session = await requireGuildAccess(guildId, 'admin');

  const payload = payloadOf(formData);
  const gameId = textOf(payload.gameId);
  const userId = textOf(payload.userId);
  if (!gameId || !userId) return { ok: false, message: 'Jogador inválido.' };
  const parsed = EditSquadProfileAnswersInputSchema.safeParse({
    actorId: session.user.id,
    answers: payload.answers,
    reason: payload.reason,
  });
  if (!parsed.success) return invalid(parsed.error);

  const game = await getSquadGame(db(), guildId, gameId);
  if (!game) return { ok: false, message: 'Esse jogo não existe mais.' };
  const checked = validateAnswers(game.fields, parsed.data.answers);
  if (!checked.success) {
    const fieldErrors = Object.fromEntries(
      Object.entries(toFieldErrors(checked.error)).map(([path, message]) => [
        path === '' ? 'answers' : `answers.${path}`,
        message,
      ]),
    );
    return { ok: false, message: 'Confira as respostas marcadas.', fieldErrors };
  }

  let result;
  try {
    result = await internalApi().editSquadProfileAnswers(guildId, gameId, userId, {
      ...parsed.data,
      answers: checked.data,
    });
  } catch (error) {
    return failure(error);
  }

  revalidatePath(PATH(guildId));
  return {
    ok: true,
    notified: result.notified,
    message: notifiedMessage('Respostas salvas', result.notified),
  };
}

export async function deletePlayerProfile(
  guildId: string,
  formData: FormData,
): Promise<PlayerActionResult> {
  const session = await requireGuildAccess(guildId, 'admin');

  const payload = payloadOf(formData);
  const gameId = textOf(payload.gameId);
  const userId = textOf(payload.userId);
  if (!gameId || !userId) return { ok: false, message: 'Jogador inválido.' };
  const parsed = DeleteSquadProfileInputSchema.safeParse({
    actorId: session.user.id,
    reason: payload.reason,
  });
  if (!parsed.success) return invalid(parsed.error);

  let result;
  try {
    result = await internalApi().deleteSquadProfile(guildId, gameId, userId, parsed.data);
  } catch (error) {
    return failure(error);
  }

  revalidatePath(PATH(guildId));
  return {
    ok: true,
    notified: result.notified,
    message: notifiedMessage('Perfil apagado', result.notified),
  };
}

export async function removePlayerFromSquad(
  guildId: string,
  formData: FormData,
): Promise<PlayerActionResult> {
  const session = await requireGuildAccess(guildId, 'admin');

  const payload = payloadOf(formData);
  const squadId = textOf(payload.squadId);
  const userId = textOf(payload.userId);
  if (!squadId || !userId) return { ok: false, message: 'Membro inválido.' };
  const parsed = RemoveSquadMemberInputSchema.safeParse({
    actorId: session.user.id,
    reason: payload.reason,
  });
  if (!parsed.success) return invalid(parsed.error);

  let result;
  try {
    result = await internalApi().removeSquadMember(guildId, squadId, userId, parsed.data);
  } catch (error) {
    return failure(error);
  }

  revalidatePath(PATH(guildId));
  return {
    ok: true,
    notified: result.notified,
    message: notifiedMessage('Pessoa tirada do squad', result.notified),
  };
}
