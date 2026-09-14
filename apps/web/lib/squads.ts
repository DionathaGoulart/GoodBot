import 'server-only';

import {
  createSquadGame,
  deleteSquadGame,
  listSearchingProfiles,
  listSquadGames,
  listSquads,
  updateSquadGame,
} from '@goodbot/db';
import {
  InternalApiError,
  SquadGameInputSchema,
  SquadNameSchema,
  type SquadChannelUsage,
  type SquadGameInput,
  type SquadProposalSummary,
  type SquadSummary,
} from '@goodbot/shared';
import { revalidatePath } from 'next/cache';

import { failure } from './action-error';
import { withAudit, type AuditActor } from './audit';
import { requireGuildAccess } from './auth/require';
import { db } from './db';
import { internalApi } from './internal-api';
import { toFieldErrors, type ActionResult } from './module-config';
import { formatMatchResult } from './squad-labels';

const PATH = (guildId: string) => `/g/${guildId}/config/squads`;

export type SquadGameRow = SquadGameInput & {
  id: string;
};

export type SearchingProfileRow = {
  userId: string;
  gameId: string;
  availability: number;
  /** ISO da última mudança no perfil (respostas, grade ou status). */
  updatedAt: string;
  /** ISO da última proposta em que o perfil entrou; `null` = nunca. */
  lastMatchedAt: string | null;
};

/** O que vem do bot. Fora do ar, as listas vêm vazias e o motivo sobe. */
export interface SquadsOverviewData {
  squads: SquadSummary[];
  openProposals: SquadProposalSummary[];
  /** `null` com o bot fora do ar: o contador sai do cache do gateway. */
  channels: SquadChannelUsage | null;
  error: string | null;
}

/** Jogos vêm do banco: a aba JOGOS funciona com o bot fora do ar. */
export async function loadSquadGames(guildId: string): Promise<SquadGameRow[]> {
  const rows = await listSquadGames(db(), guildId);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    squadSize: row.squadSize,
    enabled: row.enabled,
    fields: row.fields,
  }));
}

/**
 * Squads, propostas e o contador de canais vêm do bot, que é quem enxerga os
 * canais reais da guild (o teto de 500 é do servidor inteiro).
 */
export async function loadSquadsOverview(guildId: string): Promise<SquadsOverviewData> {
  try {
    const overview = await internalApi().squadsOverview(guildId);
    return {
      squads: overview.squads,
      openProposals: overview.openProposals,
      channels: overview.channels,
      error: null,
    };
  } catch (error) {
    return {
      squads: [],
      openProposals: [],
      channels: null,
      error:
        error instanceof InternalApiError
          ? `O bot não respondeu: ${error.message}`
          : 'O bot não respondeu.',
    };
  }
}

/**
 * Perfis na fila do match, direto do banco (o retrato do bot só traz a
 * contagem). Uma consulta por jogo: a guild tem poucos, e cada uma usa o
 * índice `(guild, jogo, status)`. Quem espera há mais tempo vem primeiro.
 */
export async function loadSearchingProfiles(
  guildId: string,
  gameIds: readonly string[],
): Promise<SearchingProfileRow[]> {
  const perGame = await Promise.all(
    gameIds.map((gameId) => listSearchingProfiles(db(), guildId, gameId)),
  );
  return perGame
    .flat()
    .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
    .map((row) => ({
      userId: row.userId,
      gameId: row.gameId,
      availability: row.availability,
      updatedAt: row.updatedAt.toISOString(),
      lastMatchedAt: row.lastMatchedAt?.toISOString() ?? null,
    }));
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
// Arquivar, renomear e publicar já entram na auditoria pelo bot, com origem
// `dashboard`; gravar aqui também duplicaria a linha. O match não: o bot não
// registra, então o painel registra.

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
