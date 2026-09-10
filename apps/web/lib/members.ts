import 'server-only';

import { countCasesForTarget, listCasesForTarget } from '@goodbot/db';
import { MemberRolesInputSchema, ModerationActionInputSchema } from '@goodbot/shared';
import { revalidatePath } from 'next/cache';

import { failure } from './action-error';
import { withAudit } from './audit';
import { defaultGuildId, requireGuildAccess } from './auth/require';
import { db } from './db';
import { internalApi } from './internal-api';
import { toFieldErrors, type ActionResult } from './module-config';

import type { GuildMemberDetail, GuildMemberSummary } from '@goodbot/shared';

const PATH = (guildId: string, userId: string) => `/g/${guildId}/membros/${userId}`;

/** Um caso na tabela do membro. Datas já em texto: isto atravessa para o client. */
export interface MemberCaseRow extends Record<string, unknown> {
  id: number;
  caseNumber: number;
  type: string;
  actorTag: string;
  reason: string | null;
  source: string;
  createdAt: string;
  expiresAt: string | null;
}

/** Quantos casos mostramos na página do membro antes de mandar para `/casos`. */
export const MEMBER_CASES_LIMIT = 25;

/**
 * Busca de membros (PRD §6.3). O bot filtra no cache dele; um ID solto que não
 * esteja no cache vira um fetch lá. Bot fora do ar devolve lista vazia com o
 * motivo, para a tela mostrar o estado de erro em vez de "nenhum membro".
 */
export async function searchMembers(
  guildId: string,
  query: string,
): Promise<{ members: GuildMemberSummary[]; error: string | null }> {
  try {
    return { members: await internalApi().members(guildId, { q: query, limit: 100 }), error: null };
  } catch (error) {
    return { members: [], error: failure(error).message ?? 'O bot não respondeu.' };
  }
}

export async function loadMember(guildId: string, userId: string): Promise<GuildMemberDetail> {
  return internalApi().member(guildId, userId);
}

export async function loadMemberCases(
  guildId: string,
  userId: string,
): Promise<{ rows: MemberCaseRow[]; total: number }> {
  const [rows, total] = await Promise.all([
    listCasesForTarget(db(), guildId, userId, { limit: MEMBER_CASES_LIMIT }),
    countCasesForTarget(db(), guildId, userId),
  ]);

  return {
    total,
    rows: rows.map((kase) => ({
      id: kase.id,
      caseNumber: kase.caseNumber,
      type: kase.type,
      actorTag: kase.actorTag,
      reason: kase.reason,
      source: kase.source,
      createdAt: kase.createdAt.toISOString(),
      expiresAt: kase.expiresAt?.toISOString() ?? null,
    })),
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

/**
 * Punir pelo painel (PRD §6.3): quem executa é o bot, pelo mesmo serviço dos
 * slash commands, então caso, mod-log, DM e escalada saem idênticos — só o
 * `source` muda para `dashboard`. `mod` basta; a hierarquia é do bot.
 */
export async function punishMember(formData: FormData): Promise<ActionResult> {
  const guildId = await defaultGuildId();
  const session = await requireGuildAccess(guildId, 'mod');

  const raw = parseBody(formData.get('action'));
  const parsed = ModerationActionInputSchema.safeParse(
    typeof raw === 'object' && raw !== null ? { ...raw, actorId: session.user.id } : raw,
  );
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Confira os campos marcados.',
      fieldErrors: toFieldErrors(parsed.error),
    };
  }
  const input = parsed.data;

  let result;
  try {
    result = await internalApi().moderate(guildId, input);
  } catch (error) {
    return failure(error, 'O bot não respondeu; nada foi aplicado.');
  }

  await withAudit(
    { id: session.user.id, tag: session.user.name, guildId: session.guildId },
    `member.${input.type}`,
    { type: 'member', id: input.targetId },
    null,
    { ...input, caseNumber: result.caseNumber },
  );
  revalidatePath(PATH(guildId, input.targetId));
  return {
    ok: true,
    message: `Caso #${result.caseNumber} criado${result.dmSent ? ' e o membro foi avisado por DM.' : '.'}`,
  };
}

/** Adicionar/remover cargos de um membro. Só `admin` (PRD §9.2). */
export async function setMemberRoles(formData: FormData): Promise<ActionResult> {
  const guildId = await defaultGuildId();
  const session = await requireGuildAccess(guildId, 'admin');

  const userId = formData.get('userId');
  if (typeof userId !== 'string') return { ok: false, message: 'Membro inválido.' };

  const raw = parseBody(formData.get('roles'));
  const parsed = MemberRolesInputSchema.safeParse(
    typeof raw === 'object' && raw !== null ? { ...raw, actorId: session.user.id } : raw,
  );
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Confira os campos marcados.',
      fieldErrors: toFieldErrors(parsed.error),
    };
  }

  let before: GuildMemberDetail | null = null;
  try {
    before = await internalApi().member(guildId, userId);
    await internalApi().setMemberRoles(guildId, userId, parsed.data);
  } catch (error) {
    return failure(error, 'O bot não respondeu; os cargos não mudaram.');
  }

  await withAudit(
    { id: session.user.id, tag: session.user.name, guildId: session.guildId },
    'member.roles.update',
    { type: 'member', id: userId },
    before?.roleIds ?? null,
    { add: parsed.data.add, remove: parsed.data.remove },
  );
  revalidatePath(PATH(guildId, userId));
  return { ok: true, message: 'Cargos atualizados.' };
}
