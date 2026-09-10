'use server';

import { removeAutomodRule, reorderAutomod, saveAutomodRule, setRaidMode } from '@/lib/automod';
import { publishPanel, removePanel, savePanel } from '@/lib/reaction-roles';
import {
  closeTicketAction,
  publishTicketPanel,
  removeTicketPanel,
  removeTicketType,
  saveTicketPanel,
  saveTicketType,
} from '@/lib/tickets';

import type { ActionResult } from '@/lib/module-config';

/**
 * As ações das telas da Etapa 15. Cada uma é uma casca fina sobre o `lib/`
 * correspondente — a checagem de permissão e a auditoria moram lá, junto da
 * escrita, para nenhum caminho novo entrar no banco sem passar por elas.
 */

// ── automod ─────────────────────────────────────────────────────────────────

export async function saveAutomodRuleAction(formData: FormData): Promise<ActionResult> {
  return saveAutomodRule(formData);
}

export async function deleteAutomodRuleAction(formData: FormData): Promise<ActionResult> {
  return removeAutomodRule(formData);
}

export async function reorderAutomodRulesAction(formData: FormData): Promise<ActionResult> {
  return reorderAutomod(formData);
}

export async function setRaidModeAction(formData: FormData): Promise<ActionResult> {
  return setRaidMode(formData);
}

// ── reaction roles ──────────────────────────────────────────────────────────

export async function savePanelAction(formData: FormData): Promise<ActionResult> {
  return savePanel(formData);
}

export async function publishPanelAction(formData: FormData): Promise<ActionResult> {
  return publishPanel(formData);
}

export async function deletePanelAction(formData: FormData): Promise<ActionResult> {
  return removePanel(formData);
}

// ── tickets ─────────────────────────────────────────────────────────────────

export async function saveTicketTypeAction(formData: FormData): Promise<ActionResult> {
  return saveTicketType(formData);
}

export async function deleteTicketTypeAction(formData: FormData): Promise<ActionResult> {
  return removeTicketType(formData);
}

export async function saveTicketPanelAction(formData: FormData): Promise<ActionResult> {
  return saveTicketPanel(formData);
}

export async function publishTicketPanelAction(formData: FormData): Promise<ActionResult> {
  return publishTicketPanel(formData);
}

export async function deleteTicketPanelAction(formData: FormData): Promise<ActionResult> {
  return removeTicketPanel(formData);
}

export async function closeTicketFormAction(formData: FormData): Promise<ActionResult> {
  return closeTicketAction(formData);
}
