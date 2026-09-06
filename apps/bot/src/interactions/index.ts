import { handlePollButton } from './poll-buttons';
import { handleVerifyButton, VERIFY_BUTTON_ID } from './verify';
import { POLL_BUTTON_PREFIX } from '../lib/poll-message';

import type { BotContext } from '../lib/command';
import type { MessageComponentInteraction } from 'discord.js';

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
 * persistentes (enquete, verificação, e na Etapa 9 reaction roles e tickets):
 * o roteamento precisa vir do `custom_id`, nunca de estado em memória.
 */
const HANDLERS: Record<string, ComponentHandler> = {
  [POLL_BUTTON_PREFIX]: (ctx, interaction) =>
    interaction.isButton() ? handlePollButton(ctx, interaction) : Promise.resolve(false),
  [VERIFY_BUTTON_ID]: async (ctx, interaction) => {
    if (!interaction.isButton()) return false;
    await handleVerifyButton(ctx, interaction);
    return true;
  },
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
