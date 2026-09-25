import 'server-only';

import { revalidatePath } from 'next/cache';

import { failure } from './action-error';
import { requireGuildAccess } from './auth/require';
import { internalApi } from './internal-api';

import type { ActionResult } from './module-config';
import type { PublishSquadGuidesResult } from '@goodbot/shared';

/**
 * Publica os guias e os botões do buscar squad, ou reedita os que estão no ar
 * (PRD §5.11). Quem escreve as mensagens e a auditoria é o bot: é o mesmo
 * caminho do `/squad painel`, e o painel só diz quem clicou.
 */
export async function publishSquadGuides(guildId: string): Promise<ActionResult> {
  const session = await requireGuildAccess(guildId, 'admin');

  let result: PublishSquadGuidesResult;
  try {
    result = await internalApi().publishSquadGuides(guildId, { actorId: session.user.id });
  } catch (error) {
    return failure(error);
  }

  // O bot acabou de gravar os ids das mensagens; a página relê para mostrar.
  revalidatePath(`/g/${guildId}/config/squads`);
  const messages = Object.values(result).filter((message) => message !== null);
  if (messages.length === 0) {
    return { ok: false, message: 'Nenhum canal configurado: escolha os canais e salve antes.' };
  }
  return {
    ok: true,
    message: messages.some((message) => message.created)
      ? 'Guias publicados.'
      : 'Guias atualizados.',
  };
}
