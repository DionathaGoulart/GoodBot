import {
  isSnowflake,
  MAX_BAN_DELETE_DAYS,
  MAX_REASON_LENGTH,
  parseDuration,
  UserFacingError,
} from '@goodbot/shared';

import { caseEmbed } from '../../lib/case-embed';

import type { ActionResult } from '../../services/moderation';
import type {
  ChatInputCommandInteraction,
  Guild,
  Interaction,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandBuilder,
  User,
} from 'discord.js';

/** Builders com `addXOption` — slash command ou um dos seus subcomandos. */
type OptionHost = SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandBuilder;

/**
 * A guild da interação. O handler já garante que só chega interação da guild
 * configurada; isto cobre o caso raro de ela não estar no cache.
 */
export function requireGuild(interaction: Interaction): Guild {
  if (!interaction.guild) {
    throw new UserFacingError('Não consegui ler este servidor. Tente novamente.', {
      code: 'NO_GUILD',
    });
  }
  return interaction.guild;
}

export function addUserOption<B extends OptionHost>(builder: B, description: string): B {
  builder.addUserOption((option) =>
    option.setName('usuario').setDescription(description).setRequired(true),
  );
  return builder;
}

export function addReasonOption<B extends OptionHost>(builder: B, required = false): B {
  builder.addStringOption((option) =>
    option
      .setName('motivo')
      .setDescription('Aparece no caso, na DM do alvo e no audit log do Discord')
      .setMaxLength(MAX_REASON_LENGTH)
      .setRequired(required),
  );
  return builder;
}

export function addDurationOption<B extends OptionHost>(
  builder: B,
  description: string,
  required = false,
): B {
  builder.addStringOption((option) =>
    option.setName('duracao').setDescription(description).setRequired(required),
  );
  return builder;
}

export function addDeleteDaysOption<B extends OptionHost>(builder: B): B {
  builder.addIntegerOption((option) =>
    option
      .setName('apagar_msgs')
      .setDescription('Dias de mensagens do alvo a apagar (0–7)')
      .setMinValue(0)
      .setMaxValue(MAX_BAN_DELETE_DAYS),
  );
  return builder;
}

/** Lê a opção `duracao`, exigindo o formato de `parseDuration` (`1h30m`, `2d`). */
export function readDuration(
  interaction: ChatInputCommandInteraction,
  name = 'duracao',
): number | undefined {
  const raw = interaction.options.getString(name);
  if (!raw) return undefined;
  const ms = parseDuration(raw);
  if (ms === null) {
    throw new UserFacingError(
      `Duração inválida: \`${raw}\`. Use algo como \`30m\`, \`2h\`, \`7d\` ou \`1h30m\`.`,
      { code: 'BAD_DURATION' },
    );
  }
  return ms;
}

/** Resolve um ID digitado (`/unban`) num `User`, sem exigir que ele esteja na guild. */
export async function fetchUserById(
  interaction: ChatInputCommandInteraction,
  id: string,
): Promise<User> {
  if (!isSnowflake(id)) {
    throw new UserFacingError(`\`${id}\` não parece um ID de usuário do Discord.`, {
      code: 'BAD_SNOWFLAKE',
    });
  }
  try {
    return await interaction.client.users.fetch(id);
  } catch {
    throw new UserFacingError('Não encontrei nenhum usuário com esse ID.', {
      code: 'UNKNOWN_USER',
    });
  }
}

/** Aviso pendurado na resposta quando a DM não chegou ao alvo. */
export function dmNotice(result: ActionResult): string | undefined {
  return result.dmSent ? undefined : 'Não foi possível avisar o usuário por DM.';
}

/**
 * Resposta padrão de uma punição: o embed do caso, o aviso de DM e — no caso
 * do `/warn` — o caso extra que a escalada criou.
 */
export function actionReply(result: ActionResult): {
  embeds: ReturnType<typeof caseEmbed>[];
  content?: string;
} {
  const embeds = [caseEmbed(result.case)];
  if (result.escalation) embeds.push(caseEmbed(result.escalation.case));

  const notices: string[] = [];
  const dm = dmNotice(result);
  if (dm) notices.push(`⚠ ${dm}`);
  if (result.escalation) {
    notices.push(
      `⚠ Escalada automática aplicada: ${result.escalation.step.warns} avisos em ` +
        `${result.escalation.step.withinDays} dia(s).`,
    );
  }

  return notices.length > 0 ? { embeds, content: notices.join('\n') } : { embeds };
}
