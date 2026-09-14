'use server';

import {
  archiveSquad,
  checkManualSquadMatch,
  deletePlayerProfile,
  editPlayerAnswers,
  proposeManualSquad,
  publishSquadSearchMessage,
  removePlayerFromSquad,
  removeSquadGame,
  renameSquad,
  runSquadMatch,
  saveSquadGame,
  setPlayerStatus,
} from '@/lib/squads';

import type { ActionResult } from '@/lib/module-config';
import type { ManualCheckResult, PlayerActionResult } from '@/lib/squads';

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

export async function checkManualSquadMatchAction(
  guildId: string,
  formData: FormData,
): Promise<ManualCheckResult> {
  return checkManualSquadMatch(guildId, formData);
}

export async function proposeManualSquadAction(
  guildId: string,
  formData: FormData,
): Promise<ActionResult & { stale?: boolean }> {
  return proposeManualSquad(guildId, formData);
}

export async function setPlayerStatusAction(
  guildId: string,
  formData: FormData,
): Promise<PlayerActionResult> {
  return setPlayerStatus(guildId, formData);
}

export async function editPlayerAnswersAction(
  guildId: string,
  formData: FormData,
): Promise<PlayerActionResult> {
  return editPlayerAnswers(guildId, formData);
}

export async function deletePlayerProfileAction(
  guildId: string,
  formData: FormData,
): Promise<PlayerActionResult> {
  return deletePlayerProfile(guildId, formData);
}

export async function removePlayerFromSquadAction(
  guildId: string,
  formData: FormData,
): Promise<PlayerActionResult> {
  return removePlayerFromSquad(guildId, formData);
}
