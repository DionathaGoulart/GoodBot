'use server';

import { publishSquadPanel } from '@/lib/squads';

import type { ActionResult } from '@/lib/module-config';

/**
 * Ações da tela de squads (PRD §5.11). Casca fina sobre `lib/squads`, como as
 * demais: a permissão mora lá, junto da chamada ao bot.
 */

export async function publishSquadPanelAction(guildId: string): Promise<ActionResult> {
  return publishSquadPanel(guildId);
}
