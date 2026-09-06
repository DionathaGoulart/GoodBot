import { formatDuration } from '@cobot/shared';
import { EmbedBuilder, time, TimestampStyles } from 'discord.js';

import { code, formatTitle, STATUS_COLORS } from './embeds';

import type { Case } from '@cobot/db';
import type { CaseType } from '@cobot/shared';

/**
 * Cor por tipo de caso (styleguide §9). O guia nomeia quatro cores de status;
 * os tipos restantes herdam a cor do seu par: `softban` é um ban, `untimeout`
 * é um unban e `note` acompanha o `warn` (ambos são registro, não punição).
 */
export const CASE_TYPE_COLORS: Record<CaseType, number> = {
  ban: STATUS_COLORS.danger,
  softban: STATUS_COLORS.danger,
  kick: STATUS_COLORS.warning,
  timeout: STATUS_COLORS.warning,
  warn: STATUS_COLORS.info,
  note: STATUS_COLORS.info,
  unban: STATUS_COLORS.success,
  untimeout: STATUS_COLORS.success,
};

/** Rótulo em caixa alta usado no título e no `/history`. */
export const CASE_TYPE_LABELS: Record<CaseType, string> = {
  ban: 'BAN',
  softban: 'SOFTBAN',
  kick: 'KICK',
  timeout: 'TIMEOUT',
  warn: 'AVISO',
  note: 'ANOTAÇÃO',
  unban: 'UNBAN',
  untimeout: 'UNTIMEOUT',
};

/** Origem do caso, para o rodapé (`command` é o caso normal e fica implícito). */
const SOURCE_LABELS: Record<Case['source'], string | null> = {
  command: null,
  context: null,
  dashboard: 'PAINEL',
  automod: 'AUTOMOD',
  escalation: 'ESCALADA',
};

/** `BAN` vira `BAN TEMPORÁRIO` quando o caso tem duração. */
export function caseTypeLabel(kase: Pick<Case, 'type' | 'durationMs'>): string {
  if (kase.type === 'ban' && kase.durationMs) return 'BAN TEMPORÁRIO';
  return CASE_TYPE_LABELS[kase.type];
}

/** `CASO #12 · MOD: fulano` (styleguide §9), com a origem quando não é comando. */
export function caseFooter(kase: Pick<Case, 'caseNumber' | 'actorTag' | 'source'>): string {
  const source = SOURCE_LABELS[kase.source];
  const base = `CASO #${kase.caseNumber} · MOD: ${kase.actorTag}`;
  return source ? `${base} · ${source}` : base;
}

/** Menção + ID em `inline code` — IDs nunca aparecem soltos (styleguide §9). */
function userField(id: string, tag: string): string {
  return `<@${id}> ${code(id)}\n${tag}`;
}

export interface CaseEmbedOptions {
  /** Marca o embed como o de um caso apagado (`/case view` de admin). */
  deleted?: boolean;
}

/** Embed completo de um caso: `/case view`, mod-log e resposta dos comandos. */
export function caseEmbed(kase: Case, options: CaseEmbedOptions = {}): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(CASE_TYPE_COLORS[kase.type])
    .setTitle(formatTitle(`${caseTypeLabel(kase)} · caso #${kase.caseNumber}`))
    .setTimestamp(kase.createdAt)
    .setFooter({ text: caseFooter(kase) })
    .addFields(
      { name: 'Alvo', value: userField(kase.targetId, kase.targetTag), inline: true },
      { name: 'Moderador', value: userField(kase.actorId, kase.actorTag), inline: true },
    );

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
      value: `${time(kase.expiresAt, TimestampStyles.ShortDateTime)} (${time(
        kase.expiresAt,
        TimestampStyles.RelativeTime,
      )})`,
      inline: false,
    });
  }

  embed.addFields({ name: 'Motivo', value: kase.reason, inline: false });

  if (kase.editedBy && kase.editedAt) {
    embed.addFields({
      name: 'Editado',
      value: `<@${kase.editedBy}> em ${time(kase.editedAt, TimestampStyles.ShortDateTime)}`,
      inline: false,
    });
  }
  if (options.deleted || kase.deletedAt) {
    embed.setDescription('⚠ Este caso foi apagado.');
  }

  return embed;
}

/** Uma linha do `/history`: `#12 · BAN · <data> — motivo`. */
export function caseLine(kase: Case): string {
  const when = time(kase.createdAt, TimestampStyles.ShortDate);
  const reason = kase.reason.length > 80 ? `${kase.reason.slice(0, 77)}…` : kase.reason;
  return `${code(`#${kase.caseNumber}`)} · **${caseTypeLabel(kase)}** · ${when} — ${reason}`;
}
