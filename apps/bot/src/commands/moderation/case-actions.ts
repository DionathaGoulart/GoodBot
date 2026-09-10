import { getCaseByNumber, softDeleteCase, updateCaseReason } from '@goodbot/db';
import { MAX_REASON_LENGTH, UserFacingError } from '@goodbot/shared';

import { caseEmbed } from '../../lib/case-embed';
import { botFooter, successEmbed } from '../../lib/embeds';

import type { CommandContext } from '../../lib/command';
import type { Case } from '@goodbot/db';

/** Busca um caso pelo número ou explica que ele não existe. */
export async function requireCase(
  ctx: Pick<CommandContext, 'db' | 'guildId'>,
  caseNumber: number,
  options: { includeDeleted?: boolean } = {},
): Promise<Case> {
  const kase = await getCaseByNumber(ctx.db, ctx.guildId, caseNumber, options);
  if (!kase) {
    throw new UserFacingError(`Não existe o caso #${caseNumber} neste servidor.`, {
      code: 'CASE_NOT_FOUND',
    });
  }
  return kase;
}

/** `/case view` — admin também enxerga casos apagados. */
export async function viewCase(ctx: CommandContext, caseNumber: number): Promise<void> {
  const kase = await requireCase(ctx, caseNumber, { includeDeleted: ctx.level === 'admin' });
  await ctx.interaction.editReply({ embeds: [caseEmbed(kase)] });
}

/** Caminho compartilhado por `/case edit` e `/reason`. */
export async function editCaseReason(
  ctx: CommandContext,
  caseNumber: number,
  reason: string,
): Promise<void> {
  const trimmed = reason.trim();
  if (!trimmed) {
    throw new UserFacingError('O motivo não pode ficar vazio.', { code: 'EMPTY_REASON' });
  }

  await requireCase(ctx, caseNumber);
  const updated = await updateCaseReason(ctx.db, ctx.guildId, caseNumber, {
    reason: trimmed.slice(0, MAX_REASON_LENGTH),
    editedBy: ctx.interaction.user.id,
  });
  if (!updated) {
    throw new UserFacingError(`Não existe o caso #${caseNumber} neste servidor.`, {
      code: 'CASE_NOT_FOUND',
    });
  }

  // A mensagem já publicada no mod-log precisa refletir o motivo novo (§5.1).
  await ctx.moderation.modlog.updateCase(updated);

  await ctx.interaction.editReply({ embeds: [caseEmbed(updated)] });
}

/** `/case delete` — soft delete, só admin (PRD §9.1). */
export async function deleteCase(ctx: CommandContext, caseNumber: number): Promise<void> {
  if (ctx.level !== 'admin') {
    throw new UserFacingError('Apagar casos é restrito a administração.', { code: 'FORBIDDEN' });
  }

  const deleted = await softDeleteCase(ctx.db, ctx.guildId, caseNumber);
  if (!deleted) {
    throw new UserFacingError(`Não existe o caso #${caseNumber} neste servidor.`, {
      code: 'CASE_NOT_FOUND',
    });
  }

  await ctx.interaction.editReply({
    embeds: [
      successEmbed({
        title: `Caso #${caseNumber} apagado`,
        description: 'O caso saiu do histórico do usuário, mas continua no banco para auditoria.',
        footer: botFooter(),
      }),
    ],
  });
}
