'use server';

import {
  archiveSquad,
  publishSquadSearchMessage,
  removeSquadGame,
  renameSquad,
  runSquadMatch,
  saveSquadGame,
} from '@/lib/squads';

import type { ActionResult } from '@/lib/module-config';

/**
 * Ações da tela de squads. Cascas finas sobre `lib/squads`, como as demais:
 * permissão e auditoria moram lá, junto da escrita.
 */

export async function saveSquadGameAction(
  guildId: string,
  formData: FormData,
): Promise<ActionResult> {
  return saveSquadGame(guildId, formData);
}

export async function deleteSquadGameAction(
  guildId: string,
  formData: FormData,
): Promise<ActionResult> {
  return removeSquadGame(guildId, formData);
}

export async function publishSquadSearchMessageAction(guildId: string): Promise<ActionResult> {
  return publishSquadSearchMessage(guildId);
}

export async function runSquadMatchAction(
  guildId: string,
  formData: FormData,
): Promise<ActionResult> {
  return runSquadMatch(guildId, formData);
}

export async function archiveSquadAction(
  guildId: string,
  formData: FormData,
): Promise<ActionResult> {
  return archiveSquad(guildId, formData);
}

export async function renameSquadAction(
  guildId: string,
  formData: FormData,
): Promise<ActionResult> {
  return renameSquad(guildId, formData);
}
