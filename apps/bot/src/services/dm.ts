import { formatDuration } from '@cobot/shared';
import { EmbedBuilder, time, TimestampStyles } from 'discord.js';

import { caseTypeLabel, CASE_TYPE_COLORS } from '../lib/case-embed';
import { childLogger } from '../logger';

import type { Case } from '@cobot/db';
import type { CaseType } from '@cobot/shared';
import type { Guild, User } from 'discord.js';

const log = childLogger('dm');

/** Frase de abertura por tipo. `note` nunca chega aqui — é invisível ao alvo. */
const HEADLINES: Partial<Record<CaseType, (guildName: string) => string>> = {
  ban: (g) => `Você foi banido de **${g}**.`,
  softban: (g) => `Suas mensagens recentes foram apagadas em **${g}** (softban).`,
  kick: (g) => `Você foi expulso de **${g}**.`,
  timeout: (g) => `Você recebeu um timeout em **${g}**.`,
  untimeout: (g) => `Seu timeout em **${g}** foi removido.`,
  warn: (g) => `Você recebeu um aviso em **${g}**.`,
  unban: (g) => `Seu banimento em **${g}** foi removido.`,
};

export function punishmentDmEmbed(
  kase: Case,
  guild: Pick<Guild, 'name' | 'iconURL'>,
  options: { footer?: string } = {},
): EmbedBuilder {
  const headline = HEADLINES[kase.type]?.(guild.name) ?? `Ação de moderação em **${guild.name}**.`;
  const embed = new EmbedBuilder()
    .setColor(CASE_TYPE_COLORS[kase.type])
    .setTitle(`> ${caseTypeLabel(kase)}`)
    .setDescription(headline)
    .addFields({ name: 'Motivo', value: kase.reason })
    .setTimestamp(kase.createdAt);

  if (kase.durationMs) {
    embed.addFields({
      name: 'Duração',
      value: formatDuration(kase.durationMs, { style: 'long' }),
      inline: true,
    });
  }
  if (kase.expiresAt) {
    embed.addFields({
      name: 'Expira',
      value: time(kase.expiresAt, TimestampStyles.RelativeTime),
      inline: true,
    });
  }

  const icon = guild.iconURL();
  if (icon) embed.setThumbnail(icon);
  if (options.footer?.trim()) embed.setFooter({ text: options.footer.trim() });

  return embed;
}

/**
 * Avisa o punido por DM. DM fechada, bloqueio ou usuário sem servidor em comum
 * são situações normais: a punição não pode falhar por causa disso, então o
 * retorno é só um `boolean` para o embed dizer "não foi possível avisar".
 */
export async function sendPunishmentDm(
  target: User,
  kase: Case,
  guild: Pick<Guild, 'name' | 'iconURL'>,
  options: { footer?: string } = {},
): Promise<boolean> {
  if (target.bot) return false;
  try {
    await target.send({ embeds: [punishmentDmEmbed(kase, guild, options)] });
    return true;
  } catch (error) {
    log.debug({ err: error, targetId: target.id, type: kase.type }, 'não foi possível enviar a DM');
    return false;
  }
}
