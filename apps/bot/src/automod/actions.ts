import { renderTemplate } from '@goodbot/shared';
import { EmbedBuilder } from 'discord.js';

import { STATUS_COLORS, code, formatTitle } from '../lib/embeds';
import { childLogger } from '../logger';

import type { LoadedRule, Violation } from './types';
import type { ModerationService } from '../services/moderation';
import type { ModlogService } from '../services/modlog';
import type { AutomodActionConfig } from '@goodbot/shared';
import type { Guild, Message, PartialMessage, User } from 'discord.js';

const log = childLogger('automod:actions');

/** `delete` primeiro: apagar depois de banir não encontraria mais a mensagem. */
const ACTION_ORDER: Record<AutomodActionConfig['type'], number> = {
  delete: 0,
  dm_user: 1,
  warn: 2,
  timeout: 3,
  kick: 4,
  ban: 5,
  notify_modlog: 6,
};

export function sortActions(actions: readonly AutomodActionConfig[]): AutomodActionConfig[] {
  return [...actions].sort((a, b) => ACTION_ORDER[a.type] - ACTION_ORDER[b.type]);
}

export interface RunActionsInput {
  moderation: ModerationService;
  modlog: ModlogService;
  guild: Guild;
  target: User;
  rule: LoadedRule;
  violation: Violation;
  /** Ausente em regras de entrada (`raid`): não há mensagem para apagar. */
  message?: Message | PartialMessage;
  /** Sobrescreve as ações da regra (modo raid usa a ação do `config`). */
  actions?: readonly AutomodActionConfig[];
}

/**
 * Executa as ações de uma regra que disparou e devolve o que de fato
 * aconteceu (vira `automod_hits.action_taken`). Nunca lança: uma ação que
 * falha não pode impedir as outras nem derrubar o evento.
 */
export async function runActions(input: RunActionsInput): Promise<string[]> {
  const { guild, target, rule, violation } = input;
  const reason = `[automod: ${rule.rule.name}] ${violation.reason}`;
  const taken: string[] = [];

  for (const action of sortActions(input.actions ?? rule.rule.actions)) {
    try {
      const done = await runAction(action, { ...input, reason });
      if (done) taken.push(action.type);
    } catch (error) {
      log.error(
        {
          err: error,
          guildId: guild.id,
          ruleId: rule.id,
          action: action.type,
          targetId: target.id,
        },
        'falha ao executar ação de automod',
      );
    }
  }

  return taken;
}

interface RunActionInput extends RunActionsInput {
  reason: string;
}

async function runAction(action: AutomodActionConfig, input: RunActionInput): Promise<boolean> {
  const { moderation, guild, target, rule, violation } = input;
  const base = {
    guild,
    target,
    source: 'automod' as const,
    automodRuleId: rule.id,
    reason: input.reason,
  };

  switch (action.type) {
    case 'delete': {
      if (!input.message?.deletable) return false;
      await input.message.delete();
      return true;
    }
    case 'dm_user': {
      return sendAutomodDm(target, guild, rule, violation, action.message);
    }
    case 'warn': {
      await moderation.warn({ ...base, reason: action.reason ?? input.reason });
      return true;
    }
    case 'timeout': {
      await moderation.timeout({
        ...base,
        reason: action.reason ?? input.reason,
        durationMs: action.durationMs,
      });
      return true;
    }
    case 'kick': {
      await moderation.kick({ ...base, reason: action.reason ?? input.reason });
      return true;
    }
    case 'ban': {
      await moderation.ban({
        ...base,
        reason: action.reason ?? input.reason,
        deleteMessageDays: action.deleteMessageDays,
      });
      return true;
    }
    case 'notify_modlog': {
      await input.modlog.postAction(guild.id, { embeds: [hitEmbed(input)] });
      return true;
    }
  }
}

/**
 * DM própria da regra. As punições já mandam a sua DM pelo
 * `ModerationService`; esta é a mensagem educativa configurada na regra.
 */
async function sendAutomodDm(
  target: User,
  guild: Guild,
  rule: LoadedRule,
  violation: Violation,
  template: string | undefined,
): Promise<boolean> {
  if (target.bot) return false;

  const text = template
    ? renderTemplate(template, {
        user: target.username,
        mention: `<@${target.id}>`,
        tag: target.tag,
        id: target.id,
        server: guild.name,
      })
    : `${violation.reason}\n\nRegra: **${rule.rule.name}** em **${guild.name}**.`;

  try {
    await target.send({
      embeds: [
        new EmbedBuilder()
          .setColor(STATUS_COLORS.warning)
          .setTitle(formatTitle('Automod'))
          .setDescription(text)
          .setTimestamp(new Date()),
      ],
    });
    return true;
  } catch (error) {
    log.debug({ err: error, targetId: target.id }, 'não foi possível enviar a DM do automod');
    return false;
  }
}

/** Embed do `notify_modlog`: quem, qual regra, o que casou e onde. */
export function hitEmbed(input: RunActionInput): EmbedBuilder {
  const { target, rule, violation } = input;
  const embed = new EmbedBuilder()
    .setColor(STATUS_COLORS.warning)
    .setTitle(formatTitle('Automod'))
    .setDescription(violation.reason)
    .addFields(
      { name: 'Usuário', value: `<@${target.id}>\n${code(target.id)}`, inline: true },
      { name: 'Regra', value: `${rule.rule.name} (${rule.rule.type})`, inline: true },
    )
    .setTimestamp(new Date());

  if (input.message?.channelId) {
    embed.addFields({ name: 'Canal', value: `<#${input.message.channelId}>`, inline: true });
  }
  if (violation.detail) {
    embed.addFields({
      name: 'Detalhe',
      value: code(violation.detail.slice(0, 200)),
      inline: false,
    });
  }
  return embed;
}
