import { handlePollButton } from './poll-buttons';
import { handleReactionRoleComponent } from './reaction-roles';
import { handleSquadComponent, handleSquadModal } from './squads';
import { handleTicketComponent, handleTicketModal } from './tickets';
import { handleVerifyButton, VERIFY_BUTTON_ID } from './verify';
import { POLL_BUTTON_PREFIX } from '../lib/poll-message';
import { REACTION_ROLE_PREFIX } from '../services/reaction-roles';
import { SQUAD_PREFIX } from '../services/squads/ids';
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
  [SQUAD_PREFIX]: handleSquadComponent,
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

/** Mesma ideia para modais: o motivo de fechamento de ticket e o perfil de squad. */
export async function handleModal(
  ctx: BotContext,
  interaction: ModalSubmitInteraction,
): Promise<boolean> {
  switch (componentPrefix(interaction.customId)) {
    case TICKET_PREFIX:
      return handleTicketModal(ctx, interaction);
    case SQUAD_PREFIX:
      return handleSquadModal(ctx, interaction);
    default:
      return false;
  }
}
