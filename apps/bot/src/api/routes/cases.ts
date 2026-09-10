import { getCaseByNumber, softDeleteCase, updateCaseReason } from '@goodbot/db';
import { CaseDeleteInputSchema, CaseEditInputSchema } from '@goodbot/shared';
import { Hono } from 'hono';

import { requireActor } from '../actor';
import { ApiHttpError, notFound } from '../errors';
import { validate } from '../validate';

import type { ApiDeps, ApiEnv } from '../context';
import type { Case } from '@goodbot/db';
import type { CaseSummary } from '@goodbot/shared';

function toSummary(kase: Case): CaseSummary {
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
    modlogChannelId: kase.modlogChannelId,
    modlogMessageId: kase.modlogMessageId,
    editedBy: kase.editedBy,
    editedAt: kase.editedAt?.toISOString() ?? null,
    deletedAt: kase.deletedAt?.toISOString() ?? null,
    createdAt: kase.createdAt.toISOString(),
  };
}

/** O número vem da URL; qualquer coisa que não seja inteiro positivo é 404. */
function parseCaseNumber(raw: string): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw notFound('Caso não encontrado.', 'CASE_NOT_FOUND');
  }
  return parsed;
}

/**
 * Edição e apagamento de casos pelo painel (PRD §6.4). Passa pelo bot porque
 * a mensagem publicada no mod-log tem de acompanhar a edição — exatamente o
 * que `/case edit` faz, com o mesmo serviço.
 */
export function createCaseRoutes(deps: ApiDeps): Hono<ApiEnv> {
  return new Hono<ApiEnv>()
    .patch('/:caseNumber', validate('json', CaseEditInputSchema), async (c) => {
      const input = c.req.valid('json');
      const guild = c.get('guild');
      const caseNumber = parseCaseNumber(c.req.param('caseNumber'));

      await requireActor(deps, guild, input.actorId, 'mod');

      const updated = await updateCaseReason(deps.db, guild.id, caseNumber, {
        reason: input.reason,
        editedBy: input.actorId,
      });
      if (!updated) throw notFound('Caso não encontrado.', 'CASE_NOT_FOUND');

      await deps.moderation.modlog.updateCase(updated);
      return c.json(toSummary(updated));
    })
    .delete('/:caseNumber', validate('json', CaseDeleteInputSchema), async (c) => {
      const input = c.req.valid('json');
      const guild = c.get('guild');
      const caseNumber = parseCaseNumber(c.req.param('caseNumber'));

      await requireActor(deps, guild, input.actorId, 'admin');

      const existing = await getCaseByNumber(deps.db, guild.id, caseNumber);
      if (!existing) throw notFound('Caso não encontrado.', 'CASE_NOT_FOUND');
      // Um caso apagado com punição ainda ativa deixaria o `unban` agendado
      // sem caso; o painel só oferece apagar depois de desfazer.
      if (existing.expiresAt && existing.expiresAt.getTime() > Date.now()) {
        throw new ApiHttpError(
          409,
          'CASE_STILL_ACTIVE',
          'Este caso ainda está em vigor. Desfaça a punição antes de apagar.',
        );
      }

      const deleted = await softDeleteCase(deps.db, guild.id, caseNumber);
      if (!deleted) throw notFound('Caso não encontrado.', 'CASE_NOT_FOUND');
      return c.json(toSummary(deleted));
    });
}
