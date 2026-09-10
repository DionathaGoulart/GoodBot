'use server';

import { deleteCase, editCaseReason, undoCase } from '@/lib/cases';

import type { ActionResult } from '@/lib/module-config';

/**
 * Ações da tela de casos (Etapa 17). Cascas finas sobre `lib/cases.ts`: a
 * permissão, a chamada ao bot e a auditoria moram lá, junto da escrita.
 */

export async function editCaseReasonAction(
  guildId: string,
  formData: FormData,
): Promise<ActionResult> {
  return editCaseReason(guildId, formData);
}

export async function deleteCaseAction(guildId: string, formData: FormData): Promise<ActionResult> {
  return deleteCase(guildId, formData);
}

export async function undoCaseAction(guildId: string, formData: FormData): Promise<ActionResult> {
  return undoCase(guildId, formData);
}
