import { getPanelByMessage } from '@cobot/db';
import { Events } from 'discord.js';

import { defineEvent } from '../../lib/event';
import {
  applyRoleChange,
  hasChange,
  ReactionRoleService,
  resolveReaction,
} from '../../services/reaction-roles';

import type { BotContext } from '../../lib/command';
import type { MessageReaction, PartialMessageReaction, PartialUser, User } from 'discord.js';

/**
 * Identificador comparável com `reaction_role_items.emoji`: `name:id` para
 * emoji customizado, o próprio caractere para unicode.
 */
export function reactionIdentifier(
  reaction: MessageReaction | PartialMessageReaction,
): string | null {
  const { id, name } = reaction.emoji;
  if (id) return name ? `${name}:${id}` : null;
  return name;
}

/**
 * Painéis com `style: reactions` continuam funcionando depois de um restart
 * porque tudo vem do banco pela mensagem reagida — daí os partials do client.
 */
async function handleReaction(
  ctx: BotContext,
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
  added: boolean,
): Promise<void> {
  if (user.bot) return;

  // Reação em mensagem fora do cache chega parcial: sem o fetch não há
  // `message.guildId` nem emoji resolvido.
  if (reaction.partial) {
    const full = await reaction.fetch().catch(() => null);
    if (!full) return;
    reaction = full;
  }

  const guildId = reaction.message.guildId;
  const messageId = reaction.message.id;
  if (!guildId) return;

  const config = await ctx.config.get(guildId, 'reaction_roles');
  if (!config.enabled) return;
  // Com `removeReactionAfter` quem tira a reação é o bot: tratar o `remove`
  // tiraria o cargo um instante depois de dá-lo.
  if (!added && config.removeReactionAfter) return;

  const panel = await getPanelByMessage(ctx.db, messageId);
  if (!panel || panel.guildId !== guildId || panel.style !== 'reactions') return;

  const identifier = reactionIdentifier(reaction);
  if (!identifier) return;
  const item = ReactionRoleService.findItemByEmoji(panel, identifier);
  if (!item) return;

  const guild = await ctx.client.guilds.fetch(guildId).catch(() => null);
  const member = await guild?.members.fetch(user.id).catch(() => null);
  if (!member) return;

  const change = resolveReaction({
    mode: panel.mode,
    roleId: item.roleId,
    added,
    panelRoleIds: panel.items.map((row) => row.roleId),
    currentRoleIds: [...member.roles.cache.keys()],
  });
  if (!hasChange(change)) return;

  try {
    await applyRoleChange(member, change);
  } catch (error) {
    ctx.logger.warn(
      { err: error, guildId, panelId: panel.id, userId: member.id },
      'não foi possível aplicar o reaction role por reação',
    );
    return;
  }

  ctx.audit.record({
    guildId,
    action: added ? 'reaction_role.add' : 'reaction_role.remove',
    source: 'event',
    actor: { id: member.id, tag: member.user.tag },
    target: { type: 'member', id: member.id },
    reason: `Reagiu com ${identifier} num painel de cargos`,
    after: { panelId: panel.id, add: change.add, remove: change.remove },
  });

  // Só no `add`: tirar a reação do próprio bot no `remove` não faz sentido.
  if (added && config.removeReactionAfter) {
    await reaction.users.remove(user.id).catch(() => null);
  }
}

export const reactionRoleAdd = defineEvent(Events.MessageReactionAdd, (ctx, reaction, user) =>
  handleReaction(ctx, reaction, user, true),
);

export const reactionRoleRemove = defineEvent(Events.MessageReactionRemove, (ctx, reaction, user) =>
  handleReaction(ctx, reaction, user, false),
);
