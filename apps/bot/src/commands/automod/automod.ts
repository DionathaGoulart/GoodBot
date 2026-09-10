import { setAutomodRuleEnabled } from '@goodbot/db';
import { MAX_MESSAGE_CONTENT_LENGTH, UserFacingError } from '@goodbot/shared';
import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import { RULE_TYPE_LABELS, resolveRule, ruleChoices } from './shared';
import { defineCommand } from '../../lib/command';
import { botFooter, code, infoEmbed, successEmbed, warningEmbed } from '../../lib/embeds';

import type { LoadedRule, MessageContext } from '../../automod/types';
import type { CommandContext } from '../../lib/command';

/** `✔ Nome · anti-spam · prioridade 100 · delete, warn`. */
function ruleLine(loaded: LoadedRule): string {
  const { rule } = loaded;
  const actions = rule.actions.map((action) => action.type).join(', ');
  const exemptions: string[] = [];
  if (rule.exemptRoleIds.length > 0) exemptions.push(`${rule.exemptRoleIds.length} cargo(s)`);
  if (rule.exemptChannelIds.length > 0)
    exemptions.push(`${rule.exemptChannelIds.length} canal(is)`);
  const suffix = exemptions.length > 0 ? ` · isenta ${exemptions.join(' e ')}` : '';

  return (
    `${rule.enabled ? '✔' : '✖'} **${rule.name}** · ${RULE_TYPE_LABELS[rule.type]} · ` +
    `prioridade ${rule.priority} · ${actions}${suffix}`
  );
}

async function list(ctx: CommandContext): Promise<void> {
  const [moduleEnabled, rules] = await Promise.all([
    ctx.config.isEnabled(ctx.guildId, 'automod'),
    ctx.automod.getRules(ctx.guildId),
  ]);

  const body =
    rules.length > 0
      ? rules.map(ruleLine).join('\n')
      : '_Nenhuma regra cadastrada. Crie no painel._';
  const description = moduleEnabled
    ? body
    : `⚠ O módulo ${code('automod')} está desligado; nada é avaliado.\n\n${body}`;

  await ctx.interaction.editReply({
    embeds: [
      infoEmbed(
        {
          title: 'Regras de automod',
          description,
          footer: botFooter(`${rules.length} regra(s)`),
        },
        ctx.settings.embedColor,
      ),
    ],
  });
}

async function toggle(ctx: CommandContext): Promise<void> {
  const query = ctx.interaction.options.getString('regra', true);
  const rules = await ctx.automod.getRules(ctx.guildId);
  const loaded = resolveRule(rules, query);

  const row = await setAutomodRuleEnabled(ctx.db, ctx.guildId, loaded.id, !loaded.rule.enabled);
  if (!row) {
    throw new UserFacingError('A regra não existe mais.', { code: 'RULE_NOT_FOUND' });
  }
  // Passa pelo bus: a API interna também escuta e limpa o cache dela.
  ctx.config.publishInvalidate(ctx.guildId, 'automod');

  await ctx.interaction.editReply({
    embeds: [
      successEmbed({
        title: row.enabled ? 'Regra ativada' : 'Regra desativada',
        description: `**${row.name}** (${RULE_TYPE_LABELS[row.type]}) agora está ${
          row.enabled ? 'ativa' : 'inativa'
        }.`,
        footer: botFooter(`REGRA: ${row.id}`),
      }),
    ],
  });
}

async function test(ctx: CommandContext): Promise<void> {
  const query = ctx.interaction.options.getString('regra', true);
  const text = ctx.interaction.options.getString('texto', true);

  const rules = await ctx.automod.getRules(ctx.guildId);
  const loaded = resolveRule(rules, query);
  if (loaded.rule.type === 'raid') {
    throw new UserFacingError('A regra anti-raid não avalia texto; use `/raid status`.', {
      code: 'RULE_NOT_TESTABLE',
    });
  }

  // Contexto sintético: um usuário fictício, para o teste não sujar a janela
  // de spam de ninguém nem mencionar de verdade.
  const message: MessageContext = {
    guildId: ctx.guildId,
    channelId: ctx.interaction.channelId,
    userId: `test:${ctx.member.id}`,
    messageId: '0',
    content: text,
    mentionedUserIds: [...text.matchAll(/<@!?(\d+)>/g)].flatMap((match) => match[1] ?? []),
    mentionedRoleIds: [...text.matchAll(/<@&(\d+)>/g)].flatMap((match) => match[1] ?? []),
    mentionsEveryone: /@everyone|@here/.test(text),
    canMentionEveryone: false,
    timestamp: Date.now(),
    isEdit: false,
  };

  const violation = ctx.automod.check(loaded, message);
  const actions = loaded.rule.actions.map((action) => action.type).join(', ');

  await ctx.interaction.editReply({
    embeds: [
      violation
        ? warningEmbed({
            title: 'A regra dispararia',
            description: violation.reason,
            fields: [
              { name: 'Regra', value: `${loaded.rule.name} (${loaded.rule.type})`, inline: true },
              { name: 'Ações', value: actions, inline: true },
              ...(violation.detail
                ? [{ name: 'O que casou', value: code(violation.detail), inline: false }]
                : []),
            ],
            footer: botFooter('SIMULAÇÃO: NADA FOI APLICADO'),
          })
        : successEmbed({
            title: 'A regra não dispararia',
            description: `O texto passa por **${loaded.rule.name}**.`,
            footer: botFooter('SIMULAÇÃO: NADA FOI APLICADO'),
          }),
    ],
  });
}

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('automod')
    .setDescription('Regras de automod')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub.setName('list').setDescription('Lista as regras e o estado de cada uma'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('toggle')
        .setDescription('Liga ou desliga uma regra')
        .addStringOption((option) =>
          option
            .setName('regra')
            .setDescription('Nome ou tipo da regra')
            .setRequired(true)
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('test')
        .setDescription('Simula um texto contra uma regra (não aplica nada)')
        .addStringOption((option) =>
          option
            .setName('regra')
            .setDescription('Nome ou tipo da regra')
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addStringOption((option) =>
          option
            .setName('texto')
            .setDescription('Texto a testar')
            .setRequired(true)
            .setMaxLength(MAX_MESSAGE_CONTENT_LENGTH),
        ),
    ),
  module: 'automod',
  level: 'admin',
  cooldown: 3,
  defer: true,
  ephemeral: true,
  help: 'Lista, liga/desliga e testa as regras de automod.',
  async execute(ctx) {
    switch (ctx.interaction.options.getSubcommand()) {
      case 'toggle':
        return toggle(ctx);
      case 'test':
        return test(ctx);
      default:
        return list(ctx);
    }
  },
  async autocomplete({ interaction, automod, guildId }) {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'regra') return;
    const rules = await automod.getRules(guildId);
    await interaction.respond(ruleChoices(rules, focused.value));
  },
});
