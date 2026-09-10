import 'server-only';

import { getCaseByNumber, searchCases } from '@goodbot/db';
import { MAX_REASON_LENGTH } from '@goodbot/shared';
import { revalidatePath } from 'next/cache';

import { failure } from './action-error';
import { withAudit } from './audit';
import { hasAccess } from './auth/access';
import { requireGuildAccess } from './auth/require';
import { EXPORT_LIMIT, PAGE_SIZE, filterRange, type CaseFilters } from './case-filters';
import { csvBody, csvHeader } from './csv';
import { db } from './db';
import { internalApi } from './internal-api';
import { guildTimezone } from './stats';

import type { ActionResult } from './module-config';
import type { AccessLevel } from './auth/access';
import type { Case } from '@goodbot/db';

const LIST_PATH = (guildId: string) => `/g/${guildId}/casos`;
const DETAIL_PATH = (guildId: string, caseNumber: number) => `/g/${guildId}/casos/${caseNumber}`;

/** Um caso como a tabela recebe: datas em texto, para atravessar o cliente. */
export interface CaseRow extends Record<string, unknown> {
  id: number;
  caseNumber: number;
  type: string;
  source: string;
  targetId: string;
  targetTag: string;
  actorId: string;
  actorTag: string;
  reason: string;
  durationMs: number | null;
  expiresAt: string | null;
  editedBy: string | null;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  modlogChannelId: string | null;
  modlogMessageId: string | null;
}

export function toCaseRow(kase: Case): CaseRow {
  return {
    id: kase.id,
    caseNumber: kase.caseNumber,
    type: kase.type,
    source: kase.source,
    targetId: kase.targetId,
    targetTag: kase.targetTag,
    actorId: kase.actorId,
    actorTag: kase.actorTag,
    reason: kase.reason,
    durationMs: kase.durationMs,
    expiresAt: kase.expiresAt?.toISOString() ?? null,
    editedBy: kase.editedBy,
    editedAt: kase.editedAt?.toISOString() ?? null,
    deletedAt: kase.deletedAt?.toISOString() ?? null,
    createdAt: kase.createdAt.toISOString(),
    modlogChannelId: kase.modlogChannelId,
    modlogMessageId: kase.modlogMessageId,
  };
}

/** Filtros da URL → argumentos do repositório, já com o fuso da guild. */
async function toSearchOptions(guildId: string, filters: CaseFilters) {
  const timezone = await guildTimezone(guildId);
  return {
    guildId,
    ...(filters.type.length ? { type: filters.type } : {}),
    ...(filters.source.length ? { source: filters.source } : {}),
    ...(filters.actorId ? { actorId: filters.actorId } : {}),
    ...(filters.targetId ? { targetId: filters.targetId } : {}),
    ...filterRange(filters, timezone),
    ...(filters.q ? { q: filters.q } : {}),
    sort: filters.sort,
    direction: filters.direction,
  };
}

export interface CasesPage {
  rows: CaseRow[];
  total: number;
  pageCount: number;
}

/** Página de casos (PRD §6.4) — filtro, ordenação e paginação no Postgres. */
export async function loadCasesPage(guildId: string, filters: CaseFilters): Promise<CasesPage> {
  const options = await toSearchOptions(guildId, filters);
  const { rows, total } = await searchCases(db(), {
    ...options,
    page: filters.page,
    pageSize: PAGE_SIZE,
  });
  return {
    rows: rows.map(toCaseRow),
    total,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

function toCsvRow(kase: Case): unknown[] {
  return [
    kase.caseNumber,
    kase.type,
    kase.source,
    kase.targetId,
    kase.targetTag,
    kase.actorId,
    kase.actorTag,
    kase.reason,
    kase.durationMs,
    kase.expiresAt,
    kase.createdAt,
    kase.editedAt,
    kase.deletedAt,
  ];
}

const CSV_HEADERS = [
  'caso',
  'tipo',
  'origem',
  'alvo_id',
  'alvo',
  'moderador_id',
  'moderador',
  'motivo',
  'duracao_ms',
  'expira_em',
  'criado_em',
  'editado_em',
  'apagado_em',
] as const;

/** Quantas linhas o CSV busca por vez; o arquivo sai em pedaços. */
const EXPORT_CHUNK = 1_000;

/**
 * Export dos casos em CSV (PRD §6.4), respeitando o filtro da tela. Sai como
 * stream em blocos de mil linhas: dez mil casos nunca ficam inteiros na
 * memória do handler, e o download começa antes da última query.
 */
export async function exportCasesCsv(
  guildId: string,
  filters: CaseFilters,
): Promise<ReadableStream<Uint8Array>> {
  const options = await toSearchOptions(guildId, filters);
  const encoder = new TextEncoder();
  const executor = db();
  let page = 1;
  let sent = 0;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(csvHeader(CSV_HEADERS)));
    },
    async pull(controller) {
      const pageSize = Math.min(EXPORT_CHUNK, EXPORT_LIMIT - sent);
      if (pageSize <= 0) {
        controller.close();
        return;
      }

      const { rows } = await searchCases(executor, { ...options, page, pageSize });
      page += 1;
      sent += rows.length;
      if (rows.length > 0) controller.enqueue(encoder.encode(csvBody(rows.map(toCsvRow))));
      if (rows.length < pageSize) controller.close();
    },
  });
}

/** O que ainda dá para desfazer num caso, e por quê não dá. */
export type UndoKind = 'unban' | 'untimeout';

export interface CaseDetail {
  kase: CaseRow;
  /** `null` quando não há nada a desfazer. */
  undo: UndoKind | null;
}

const UNDO_FOR: Partial<Record<string, UndoKind>> = { ban: 'unban', timeout: 'untimeout' };

/**
 * O caso e se ele ainda pode ser desfeito. "Ainda ativo" é: nenhum caso de
 * `unban`/`untimeout` para o mesmo alvo depois deste e, no timeout, a data de
 * expiração ainda no futuro — o Discord solta o castigo sozinho.
 */
export async function loadCaseDetail(
  guildId: string,
  caseNumber: number,
  options: { includeDeleted?: boolean } = {},
): Promise<CaseDetail | null> {
  const kase = await getCaseByNumber(db(), guildId, caseNumber, options);
  if (!kase) return null;

  const undoKind = UNDO_FOR[kase.type];
  const expired = kase.expiresAt !== null && kase.expiresAt.getTime() <= Date.now();
  if (!undoKind || kase.deletedAt || expired || (kase.type === 'timeout' && !kase.expiresAt)) {
    return { kase: toCaseRow(kase), undo: null };
  }

  const { total } = await searchCases(db(), {
    guildId,
    targetId: kase.targetId,
    type: [undoKind],
    from: kase.createdAt,
    pageSize: 1,
  });

  return { kase: toCaseRow(kase), undo: total === 0 ? undoKind : null };
}

function reasonFrom(formData: FormData): string {
  const raw = formData.get('reason');
  return typeof raw === 'string' ? raw.trim().slice(0, MAX_REASON_LENGTH) : '';
}

function caseNumberFrom(formData: FormData): number | null {
  const raw = Number(formData.get('caseNumber'));
  return Number.isInteger(raw) && raw > 0 ? raw : null;
}

/**
 * Editar o motivo (PRD §6.4). Quem escreve é o bot: a mensagem já publicada no
 * mod-log tem de acompanhar a edição, e só ele fala com o Discord.
 */
export async function editCaseReason(guildId: string, formData: FormData): Promise<ActionResult> {
  const session = await requireGuildAccess(guildId, 'mod');

  const caseNumber = caseNumberFrom(formData);
  if (caseNumber === null) return { ok: false, message: 'Caso inválido.' };

  const reason = reasonFrom(formData);
  if (!reason) {
    return {
      ok: false,
      message: 'Confira os campos marcados.',
      fieldErrors: { reason: 'O motivo não pode ficar vazio.' },
    };
  }

  const before = await getCaseByNumber(db(), guildId, caseNumber);
  if (!before) return { ok: false, message: `O caso #${caseNumber} não existe.` };

  try {
    await internalApi().editCase(guildId, caseNumber, { actorId: session.user.id, reason });
  } catch (error) {
    return failure(error, 'O bot não respondeu; o motivo não mudou.');
  }

  await withAudit(
    { id: session.user.id, tag: session.user.name, guildId: session.guildId },
    'case.edit',
    { type: 'case', id: String(caseNumber) },
    { reason: before.reason },
    { reason },
  );
  revalidatePath(DETAIL_PATH(guildId, caseNumber));
  revalidatePath(LIST_PATH(guildId));
  return { ok: true, message: 'Motivo atualizado e mod-log reeditado.' };
}

/** Apagar (soft delete). Só `admin` (PRD §9.2); o caso fica no banco. */
export async function deleteCase(guildId: string, formData: FormData): Promise<ActionResult> {
  const session = await requireGuildAccess(guildId, 'admin');

  const caseNumber = caseNumberFrom(formData);
  if (caseNumber === null) return { ok: false, message: 'Caso inválido.' };

  const before = await getCaseByNumber(db(), guildId, caseNumber);
  if (!before) return { ok: false, message: `O caso #${caseNumber} não existe.` };

  try {
    await internalApi().deleteCase(guildId, caseNumber, { actorId: session.user.id });
  } catch (error) {
    return failure(error, 'O bot não respondeu; o caso continua no histórico.');
  }

  await withAudit(
    { id: session.user.id, tag: session.user.name, guildId: session.guildId },
    'case.delete',
    { type: 'case', id: String(caseNumber) },
    { type: before.type, targetId: before.targetId, reason: before.reason },
    null,
  );
  revalidatePath(DETAIL_PATH(guildId, caseNumber));
  revalidatePath(LIST_PATH(guildId));
  return { ok: true, message: `Caso #${caseNumber} saiu do histórico do usuário.` };
}

/**
 * `DESFAZER` — o unban/untimeout correspondente, pelo mesmo caminho de uma
 * punição do painel: vira um caso novo, com mod-log e tudo (PRD §6.4).
 */
export async function undoCase(guildId: string, formData: FormData): Promise<ActionResult> {
  const session = await requireGuildAccess(guildId, 'mod');

  const caseNumber = caseNumberFrom(formData);
  if (caseNumber === null) return { ok: false, message: 'Caso inválido.' };

  const detail = await loadCaseDetail(guildId, caseNumber);
  if (!detail) return { ok: false, message: `O caso #${caseNumber} não existe.` };
  if (!detail.undo) {
    return { ok: false, message: 'Este caso não tem o que desfazer.' };
  }

  const reason = reasonFrom(formData) || `Desfeito pelo painel (caso #${caseNumber})`;

  let result;
  try {
    result = await internalApi().moderate(guildId, {
      type: detail.undo,
      targetId: detail.kase.targetId,
      actorId: session.user.id,
      reason,
      source: 'dashboard',
    });
  } catch (error) {
    return failure(error, 'O bot não respondeu; a punição continua valendo.');
  }

  await withAudit(
    { id: session.user.id, tag: session.user.name, guildId: session.guildId },
    `case.undo.${detail.undo}`,
    { type: 'case', id: String(caseNumber) },
    { type: detail.kase.type, targetId: detail.kase.targetId },
    { caseNumber: result.caseNumber, reason },
  );
  revalidatePath(DETAIL_PATH(guildId, caseNumber));
  revalidatePath(LIST_PATH(guildId));
  return { ok: true, message: `Desfeito no caso #${result.caseNumber}.` };
}

/** `admin` enxerga casos apagados; `mod` não (PRD §9.2). */
export function canSeeDeleted(level: AccessLevel): boolean {
  return hasAccess(level, 'admin');
}
