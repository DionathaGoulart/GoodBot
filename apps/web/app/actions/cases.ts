'use server';

import { deleteCase, editCaseReason, undoCase } from '@/lib/cases';

import type { ActionResult } from '@/lib/module-config';

/**
 * Ações da tela de casos (Etapa 17). Cascas finas sobre `lib/cases.ts`: a
 * permissão, a chamada ao bot e a auditoria moram lá, junto da escrita.
 */

export async function editCaseReasonAction(formData: FormData): Promise<ActionResult> {
  return editCaseReason(formData);
}

export async function deleteCaseAction(formData: FormData): Promise<ActionResult> {
  return deleteCase(formData);
}

export async function undoCaseAction(formData: FormData): Promise<ActionResult> {
  return undoCase(formData);
}
