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

export async function saveAutomodRuleAction(
  guildId: string,
  formData: FormData,
): Promise<ActionResult> {
  return saveAutomodRule(guildId, formData);
}

export async function deleteAutomodRuleAction(
  guildId: string,
  formData: FormData,
): Promise<ActionResult> {
  return removeAutomodRule(guildId, formData);
}

export async function reorderAutomodRulesAction(
  guildId: string,
  formData: FormData,
): Promise<ActionResult> {
  return reorderAutomod(guildId, formData);
}

export async function setRaidModeAction(
  guildId: string,
  formData: FormData,
): Promise<ActionResult> {
  return setRaidMode(guildId, formData);
}

// ── reaction roles ──────────────────────────────────────────────────────────

export async function savePanelAction(guildId: string, formData: FormData): Promise<ActionResult> {
  return savePanel(guildId, formData);
}

export async function publishPanelAction(
  guildId: string,
  formData: FormData,
): Promise<ActionResult> {
  return publishPanel(guildId, formData);
}

export async function deletePanelAction(
  guildId: string,
  formData: FormData,
): Promise<ActionResult> {
  return removePanel(guildId, formData);
}

// ── tickets ─────────────────────────────────────────────────────────────────

export async function saveTicketTypeAction(
  guildId: string,
  formData: FormData,
): Promise<ActionResult> {
  return saveTicketType(guildId, formData);
}

export async function deleteTicketTypeAction(
  guildId: string,
  formData: FormData,
): Promise<ActionResult> {
  return removeTicketType(guildId, formData);
}

export async function saveTicketPanelAction(
  guildId: string,
  formData: FormData,
): Promise<ActionResult> {
  return saveTicketPanel(guildId, formData);
}

export async function publishTicketPanelAction(
  guildId: string,
  formData: FormData,
): Promise<ActionResult> {
  return publishTicketPanel(guildId, formData);
}

export async function deleteTicketPanelAction(
  guildId: string,
  formData: FormData,
): Promise<ActionResult> {
  return removeTicketPanel(guildId, formData);
}

export async function closeTicketFormAction(
  guildId: string,
  formData: FormData,
): Promise<ActionResult> {
  return closeTicketAction(guildId, formData);
}
