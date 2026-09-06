import { handlePollButton } from './poll-buttons';
import { handleReactionRoleComponent } from './reaction-roles';
import { handleTicketComponent, handleTicketModal } from './tickets';
import { handleVerifyButton, VERIFY_BUTTON_ID } from './verify';
import { POLL_BUTTON_PREFIX } from '../lib/poll-message';
import { REACTION_ROLE_PREFIX } from '../services/reaction-roles';
import { TICKET_PREFIX } from '../services/tickets';

import type { BotContext } from '../lib/command';
import type { MessageComponentInteraction, ModalSubmitInteraction } from 'discord.js';

/**
 * O `custom_id` é sempre `<prefixo>[:<argumentos>]`. O prefixo é o que decide
 * o handler; os argumentos são problema de quem trata.
 */
export function componentPrefix(customId: string): string {
  return customId.split(':', 1)[0] ?? '';
}

/** `false` = o handler não reconheceu o `custom_id` e ninguém respondeu. */
type ComponentHandler = (
  ctx: BotContext,
  interaction: MessageComponentInteraction,
) => Promise<boolean>;

/**
 * Registro de handlers de componente por prefixo. Mensagens com botão são
 * persistentes (enquete, verificação, reaction roles, tickets): o roteamento
 * precisa vir do `custom_id`, nunca de estado em memória.
 */
const HANDLERS: Record<string, ComponentHandler> = {
  [POLL_BUTTON_PREFIX]: (ctx, interaction) =>
    interaction.isButton() ? handlePollButton(ctx, interaction) : Promise.resolve(false),
  [VERIFY_BUTTON_ID]: async (ctx, interaction) => {
    if (!interaction.isButton()) return false;
    await handleVerifyButton(ctx, interaction);
    return true;
  },
  [REACTION_ROLE_PREFIX]: handleReactionRoleComponent,
  [TICKET_PREFIX]: (ctx, interaction) =>
    interaction.isButton() ? handleTicketComponent(ctx, interaction) : Promise.resolve(false),
};

/** `false` quando nenhum handler reconhece o `custom_id` (mensagem antiga). */
export async function handleComponent(
  ctx: BotContext,
  interaction: MessageComponentInteraction,
): Promise<boolean> {
  const handler = HANDLERS[componentPrefix(interaction.customId)];
  if (!handler) return false;
  return handler(ctx, interaction);
}

/** Mesma ideia para modais: hoje só o do motivo de fechamento de ticket. */
export async function handleModal(
  ctx: BotContext,
  interaction: ModalSubmitInteraction,
): Promise<boolean> {
  if (componentPrefix(interaction.customId) === TICKET_PREFIX) {
    return handleTicketModal(ctx, interaction);
  }
  return false;
}
