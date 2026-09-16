'use server';

import {
  approveGuild,
  blockGuild,
  broadcast,
  leaveGuild,
  resyncCommands,
  setMaintenance,
  setMessageCache,
} from '@/lib/admin';

import type { BroadcastOutcome, MaintenanceOutcome, ResyncOutcome } from '@/lib/admin';
import type { ActionResult } from '@/lib/module-config';

/**
 * As ações do painel do dono. Cascas finas sobre `lib/admin`, como o resto do
 * painel: a checagem de `OWNER_DISCORD_ID` mora lá, junto da escrita, para
 * nenhum caminho novo conseguir escapar dela.
 */

export async function approveGuildAction(formData: FormData): Promise<ActionResult> {
  return approveGuild(formData);
}

export async function blockGuildAction(formData: FormData): Promise<ActionResult> {
  return blockGuild(formData);
}

export async function leaveGuildAction(formData: FormData): Promise<ActionResult> {
  return leaveGuild(formData);
}

export async function broadcastAction(formData: FormData): Promise<BroadcastOutcome> {
  return broadcast(formData);
}

export async function setMaintenanceAction(formData: FormData): Promise<MaintenanceOutcome> {
  return setMaintenance(formData);
}

export async function resyncCommandsAction(formData: FormData): Promise<ResyncOutcome> {
  return resyncCommands(formData);
}

export async function setMessageCacheAction(formData: FormData): Promise<ActionResult> {
  return setMessageCache(formData);
}
