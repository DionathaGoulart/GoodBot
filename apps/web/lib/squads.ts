import 'server-only';

import { revalidatePath } from 'next/cache';

import { failure } from './action-error';
import { requireGuildAccess } from './auth/require';
import { internalApi } from './internal-api';

import type { ActionResult } from './module-config';

/**
 * Publica o painel fixo das salas de squad, ou reedita o que está no ar (PRD
 * §5.11). Quem escreve a mensagem e a auditoria (`squad.panel.publish`) é o
 * bot: é o mesmo caminho do `/squad painel`, e o painel só diz quem clicou.
 */
export async function publishSquadPanel(guildId: string): Promise<ActionResult> {
  const session = await requireGuildAccess(guildId, 'admin');

  let created: boolean;
  try {
    ({ created } = await internalApi().publishSquadPanel(guildId, { actorId: session.user.id }));
  } catch (error) {
    return failure(error);
  }

  // O bot acabou de gravar o `panelMessageId`; a página relê para mostrar.
  revalidatePath(`/g/${guildId}/config/squads`);
  return { ok: true, message: created ? 'Painel publicado.' : 'Painel atualizado.' };
}
