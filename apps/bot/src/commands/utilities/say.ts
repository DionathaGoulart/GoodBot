import { MAX_MESSAGE_CONTENT_LENGTH, MINUTE_MS, UserFacingError } from '@goodbot/shared';
import {
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

import { addChannelOption, requireUtilities, resolveTextChannel } from './shared';
import { defineCommand } from '../../lib/command';
import { botFooter, code, successEmbed } from '../../lib/embeds';
import { logEmbed } from '../../lib/log-embeds';

import type { CommandContext } from '../../lib/command';
import type {
  GuildTextBasedChannel,
  Message,
  MessageMentionOptions,
  MessageMentionTypes,
  ModalSubmitInteraction,
} from 'discord.js';

/** Quanto tempo o modal fica de pé esperando o texto. */
const MODAL_TIMEOUT_MS = 5 * MINUTE_MS;

/** Quanto da mensagem entra no mod-log; o resto está a um clique no link. */
const LOG_PREVIEW_LENGTH = 300;

const builder = new SlashCommandBuilder()
  .setName('say')
  .setDescription('Publica no canal um texto seu como mensagem do bot')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .addBooleanOption((option) =>
    option.setName('fixar').setDescription('Fixa a mensagem no canal depois de publicar'),
  )
  .addBooleanOption((option) =>
    option
      .setName('mencoes')
      .setDescription('Deixa as menções pingarem de verdade (padrão: não pingam)'),
  );
addChannelOption(builder, 'Onde publicar (padrão: este canal)');

export default defineCommand({
  data: builder,
  module: 'utilities',
  level: 'mod',
  cooldown: 5,
  help: 'Abre um modal e publica o texto no canal como mensagem do bot.',
  // Sem `defer`: o `showModal` exige a interação intacta, e o `opensModal`
  // desliga também o adiamento automático dos 2,5 s.
  opensModal: true,
  async execute(ctx) {
    const { interaction } = ctx;
    await requireUtilities(ctx);
    // Resolvido antes do modal: não adianta abrir o editor para descobrir
    // depois de escrever tudo que o canal não aceita mensagem.
    const channel = resolveTextChannel(interaction);

    const customId = `say:${interaction.id}`;
    await interaction.showModal(buildModal(customId, channel.name));

    const submit = await interaction
      .awaitModalSubmit({
        time: MODAL_TIMEOUT_MS,
        filter: (modal) => modal.customId === customId && modal.user.id === interaction.user.id,
      })
      .catch(() => null);
    // Modal fechado sem enviar: não há interação pendente a responder.
    if (!submit) return;

    await submit.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      await publish(ctx, submit, channel);
    } catch (error) {
      // O erro pertence à interação do modal, não à do comando — o handler
      // genérico não alcança esta aqui.
      const message =
        error instanceof UserFacingError
          ? error.message
          : 'Algo deu errado ao publicar. A equipe já foi avisada.';
      if (!(error instanceof UserFacingError)) {
        ctx.logger.error({ err: error, command: 'say' }, 'falha ao publicar mensagem do bot');
      }
      await submit.editReply({ content: `⚠ ${message}` });
    }
  },
});

/**
 * O editor do texto. É modal e não opção de comando porque opção de slash
 * command não aceita quebra de linha, e mensagem de canal quase sempre tem.
 */
function buildModal(customId: string, channelName: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(`Publicar em #${channelName}`.slice(0, 45))
    .setLabelComponents(
      new LabelBuilder()
        .setLabel('Mensagem')
        .setDescription('Quebra de linha e markdown do Discord valem aqui.')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId('texto')
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(MAX_MESSAGE_CONTENT_LENGTH)
            .setRequired(true),
        ),
    );
}

/**
 * O padrão é não pingar ninguém: quem escreve pelo bot escreve para um canal
 * inteiro, e um `@everyone` colado sem querer acorda o servidor. `@everyone` só
 * entra quando quem mandou tem a permissão no próprio Discord (PRD §9.2).
 */
export function mentionOptions(
  enabled: boolean,
  canMentionEveryone: boolean,
): MessageMentionOptions {
  if (!enabled) return { parse: [] };
  const parse: MessageMentionTypes[] = ['users', 'roles'];
  if (canMentionEveryone) parse.push('everyone');
  return { parse };
}

/** Trecho do conteúdo para o mod-log, sem estourar o field do embed. */
export function preview(content: string): string {
  return content.length > LOG_PREVIEW_LENGTH ? `${content.slice(0, LOG_PREVIEW_LENGTH)}…` : content;
}

/**
 * O resultado de fixar, já com a frase que vai para quem mandou. O chat de um
 * canal de voz não tem mensagem fixada no Discord: dizer "confira o limite de
 * 50" ali mandaria a pessoa procurar um problema que não existe.
 */
export function pinOutcome(voiceChat: boolean, ok: boolean): { ok: boolean; detail: string } {
  if (voiceChat) {
    return {
      ok: false,
      detail: 'Não dá para fixar: o chat de canal de voz do Discord não tem mensagem fixada.',
    };
  }
  return ok
    ? { ok: true, detail: 'Fixada no canal.' }
    : { ok: false, detail: 'Não consegui fixar: confira o limite de 50 fixadas do canal.' };
}

async function pin(
  message: Message,
  channel: GuildTextBasedChannel,
): Promise<{ ok: boolean; detail: string }> {
  if (channel.isVoiceBased()) return pinOutcome(true, false);
  const ok = await message
    .pin()
    .then(() => true)
    .catch(() => false);
  return pinOutcome(false, ok);
}

async function publish(
  ctx: CommandContext,
  submit: ModalSubmitInteraction,
  channel: GuildTextBasedChannel,
): Promise<void> {
  const content = submit.fields.getTextInputValue('texto').trim();
  if (!content) {
    throw new UserFacingError('A mensagem veio vazia.', { code: 'EMPTY_MESSAGE' });
  }

  const shouldPin = ctx.interaction.options.getBoolean('fixar') ?? false;
  const mentions = ctx.interaction.options.getBoolean('mencoes') ?? false;

  const sent = await channel.send({
    content,
    allowedMentions: mentionOptions(
      mentions,
      ctx.member.permissions.has(PermissionFlagsBits.MentionEveryone),
    ),
  });

  // Fixar é o passo que pode falhar sozinho, e a mensagem já saiu: isso vira
  // aviso, não erro. O chat de canal de voz nem tenta — o Discord não tem
  // mensagem fixada ali, então a chamada só voltaria com um erro opaco.
  const pinned = shouldPin ? await pin(sent, channel) : null;

  const lines = [`Publicada em <#${channel.id}>. [Ver mensagem](${sent.url})`];
  if (pinned) lines.push(pinned.detail);

  await submit.editReply({
    embeds: [
      successEmbed({
        title: 'Mensagem publicada',
        description: lines.join('\n'),
        footer: botFooter(),
      }),
    ],
  });

  await ctx.modlog.postAction(ctx.guildId, {
    embeds: [
      logEmbed({
        title: 'Mensagem publicada pelo bot',
        tone: 'create',
        description: `<@${ctx.member.id}> publicou uma mensagem como o bot em <#${channel.id}>.`,
        fields: [
          { name: 'Moderador', value: `<@${ctx.member.id}>\n${code(ctx.member.id)}`, inline: true },
          { name: 'Canal', value: `<#${channel.id}>`, inline: true },
          { name: 'Fixada', value: pinned?.ok ? 'sim' : 'não', inline: true },
          { name: 'Conteúdo', value: preview(content) },
        ],
        footer: `MENSAGEM: ${sent.id}`,
      }),
    ],
  });
}
