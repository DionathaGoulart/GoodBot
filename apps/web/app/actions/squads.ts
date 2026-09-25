'use server';

import { publishSquadGuides } from '@/lib/squads';

import type { ActionResult } from '@/lib/module-config';

/**
 * Ações da tela de squads (PRD §5.11). Casca fina sobre `lib/squads`, como as
 * demais: a permissão mora lá, junto da chamada ao bot.
 */

export async function publishSquadGuidesAction(guildId: string): Promise<ActionResult> {
  return publishSquadGuides(guildId);
}
