import type { MessageRule } from '../types';

export const mentionsRule: MessageRule<'mentions'> = {
  type: 'mentions',
  check({ ctx, config }) {
    if (config.blockEveryone && ctx.mentionsEveryone && !ctx.canMentionEveryone) {
      return { reason: 'Menção a @everyone/@here sem permissão.', detail: '@everyone' };
    }

    const total =
      new Set(ctx.mentionedUserIds).size +
      (config.countRoles ? new Set(ctx.mentionedRoleIds).size : 0);
    if (total <= config.maxMentions) return null;

    return {
      reason: `Menção em massa: mais de ${config.maxMentions} menções numa mensagem.`,
      detail: `${total} menções`,
    };
  },
};
