import {
  describeWhen,
  LFG_MAX_SLOTS,
  LFG_MIN_SLOTS,
  LFG_NOTE_MAX_LENGTH,
  LFG_PROMPT_COOLDOWN_HOURS,
  LFG_WHEN_MAX_LENGTH,
  ScheduleSessionInputSchema,
  UserFacingError,
  WHEN_EXAMPLES,
} from '@goodbot/shared';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

import { botFooter, infoEmbed } from '../lib/embeds';
import { levelAtLeast, resolveLevel, toMemberLike } from '../services/permissions';
import { JOIN_TEXT, LEAVE_TEXT } from '../services/squads/agenda';
import { parseSquadId, SCHEDULE_FIELDS, SCHEDULE_ID, visibilityId } from '../services/squads/ids';

import type { BotContext } from '../lib/command';
import type { RequestAnswerResult, ScheduleDraft } from '../services/squads/agenda';
import type { SquadCustomId, SquadDmChoice } from '../services/squads/ids';
import type { SearchState } from '../services/squads/presence';
import type { SquadsConfig } from '@goodbot/shared';
import type {
  ButtonInteraction,
  Guild,
  GuildMember,
  MessageComponentInteraction,
  ModalSubmitInteraction,
} from 'discord.js';

export const STALE_FLOW_TEXT =
  'Aquele fluxo de squad acabou. Agora é só entrar no **➕ Criar Squad** ou usar o botão ' +
  '**BUSCAR SQUAD** do painel de squads.';

export function searchToggledText(state: SearchState, config: SquadsConfig): string {
  return state === 'on'
    ? 'Pronto: você está **buscando squad**. O cargo cai sozinho quando você sai da voz, ' +
        `ou em ${String(config.searchTtlMinutes)} minutos se não entrar em nenhuma.`
    : 'Pronto: você **parou de buscar** squad.';
}

export function optOutToggledText(state: SearchState): string {
  return state === 'on'
    ? 'Pronto: não te aviso mais quando você abrir o jogo. Para buscar squad, use o botão ' +
        '**BUSCAR SQUAD** do painel ou `/squad buscar`; para voltar a receber o aviso, ' +
        '**SEM AVISO** ou `/squad aviso`.'
    : 'Pronto: voltei a te avisar quando você abrir o jogo.';
}

export async function squadsConfigOrFail(ctx: BotContext, guildId: string): Promise<SquadsConfig> {
  const config = await ctx.config.get(guildId, 'squads');
  if (!config.enabled) {
    throw new UserFacingError('O módulo de squads está desligado neste servidor.', {
      code: 'MODULE_DISABLED',
    });
  }
  return config;
}

/** O modal do MARCAR JOGATINA: quando, vagas e nota. Aberta ou fechada vem depois, em botão. */
export function scheduleModal(config: Pick<SquadsConfig, 'roomSize'>): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(SCHEDULE_ID)
    .setTitle('Marcar jogatina')
    .setLabelComponents(
      new LabelBuilder()
        .setLabel('Quando')
        .setDescription(`No horário do servidor. Exemplos: ${WHEN_EXAMPLES}.`)
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(SCHEDULE_FIELDS.when)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('hoje 21h')
            .setMaxLength(LFG_WHEN_MAX_LENGTH)
            .setRequired(true),
        ),
      new LabelBuilder()
        .setLabel('Vagas')
        .setDescription(
          `De ${String(LFG_MIN_SLOTS)} a ${String(LFG_MAX_SLOTS)}, contando você. ` +
            `Vazio: ${String(config.roomSize)}.`,
        )
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(SCHEDULE_FIELDS.slots)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(String(config.roomSize))
            .setMaxLength(2)
            .setRequired(false),
        ),
      new LabelBuilder()
        .setLabel('Nota')
        .setDescription('O que vão jogar, dificuldade, o que precisar saber.')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(SCHEDULE_FIELDS.note)
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('dificuldade 10, terminids')
            .setMaxLength(LFG_NOTE_MAX_LENGTH)
            .setRequired(false),
        ),
    );
}

/** O resumo do modal com a última escolha: ABERTA ou FECHADA. */
export function visibilityPrompt(draft: ScheduleDraft, now: Date, timeZone: string) {
  const unix = String(Math.floor(draft.startsAt.getTime() / 1000));
  const note = draft.note ? `\n> ${draft.note.replace(/\n/g, '\n> ')}` : '';
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(visibilityId('open'))
      .setLabel('ABERTA')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(visibilityId('closed'))
      .setLabel('FECHADA')
      .setStyle(ButtonStyle.Secondary),
  );
  return {
    content:
      `Jogatina **${describeWhen(draft.startsAt, now, timeZone)}** (<t:${unix}:F>), ` +
      `${String(draft.slots)} vagas contando você.${note}\n\n` +
      '**ABERTA**: quem clicar em VOU entra na hora. ' +
      '**FECHADA**: cada pedido de vaga chega na sua DM para você aceitar ou recusar.',
    components: [row],
  };
}

/** Quem clicou, com a guild à mão: sem guild em cache não há cargo a ler. */
function memberOf(interaction: MessageComponentInteraction | ModalSubmitInteraction): GuildMember {
  if (!interaction.inCachedGuild()) {
    throw new UserFacingError('Não consegui ler seus cargos. Tente de novo.', {
      code: 'NO_MEMBER',
    });
  }
  return interaction.member;
}

/** Host ou staff (`mod`+): quem pode responder a um pedido de vaga na thread. */
async function canManage(ctx: BotContext, member: GuildMember, hostId: string): Promise<boolean> {
  if (member.id === hostId) return true;
  const settings = await ctx.config.getSettings(member.guild.id);
  return levelAtLeast(resolveLevel(toMemberLike(member), settings), 'mod');
}

/**
 * Componentes do módulo em mensagem de servidor. Todo `custom_id` com o
 * prefixo é tratado aqui, inclusive os do squad fixo que ainda estão no ar:
 * esses respondem que o fluxo acabou, em vez do "botão não vale mais" genérico.
 */
export async function handleSquadComponent(
  ctx: BotContext,
  interaction: MessageComponentInteraction,
): Promise<boolean> {
  const parsed = parseSquadId(interaction.customId);
  if (!interaction.isButton() || !parsed || parsed.kind === 'dm') {
    await interaction.reply({ content: STALE_FLOW_TEXT, flags: MessageFlags.Ephemeral });
    return true;
  }
  if (parsed.kind === 'request') return handleSquadRequestButton(ctx, interaction);
  const member = memberOf(interaction);
  const guildId = member.guild.id;
  // O modal precisa da interação intacta: nada de `deferReply` antes dele.
  if (parsed.kind === 'schedule') {
    const config = await squadsConfigOrFail(ctx, guildId);
    await interaction.showModal(scheduleModal(config));
    return true;
  }
  // ABERTA ou FECHADA troca a própria resposta efêmera do modal.
  if (parsed.kind === 'visibility') {
    await interaction.deferUpdate();
    const config = await squadsConfigOrFail(ctx, guildId);
    const scheduled = await ctx.squadAgenda.schedule(member, parsed.visibility, config, 'command');
    await interaction.editReply({
      content: `Jogatina marcada: [ver na agenda](${scheduled.url}). A conversa fica na thread dela.`,
      components: [],
    });
    return true;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const config = await squadsConfigOrFail(ctx, guildId);
  const content = await componentText(ctx, member, parsed, config);
  await interaction.editReply({ content });
  return true;
}

async function componentText(
  ctx: BotContext,
  member: GuildMember,
  parsed: Extract<SquadCustomId, { kind: 'search' | 'optout' | 'agenda' }>,
  config: SquadsConfig,
): Promise<string> {
  switch (parsed.kind) {
    case 'search':
      return searchToggledText(await ctx.squads.toggleSearch(member, config), config);
    case 'optout':
      return optOutToggledText(await ctx.squads.toggleOptOut(member, config));
    case 'agenda':
      return parsed.action === 'join'
        ? JOIN_TEXT[await ctx.squadAgenda.join(member, parsed.sessionId)]
        : LEAVE_TEXT[await ctx.squadAgenda.leave(member, parsed.sessionId)];
  }
}

/**
 * O modal da jogatina, venha ele do botão do painel ou do `/squad agendar`.
 * Confere o formato e o "quando" e responde com ABERTA e FECHADA; o erro de
 * leitura volta em efêmero, com exemplos.
 */
export async function handleSquadModal(
  ctx: BotContext,
  interaction: ModalSubmitInteraction,
): Promise<boolean> {
  if (parseSquadId(interaction.customId)?.kind !== 'schedule') return false;
  const member = memberOf(interaction);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const config = await squadsConfigOrFail(ctx, member.guild.id);
  const parsed = ScheduleSessionInputSchema.omit({ visibility: true }).safeParse({
    when: interaction.fields.getTextInputValue(SCHEDULE_FIELDS.when),
    slots: interaction.fields.getTextInputValue(SCHEDULE_FIELDS.slots),
    note: interaction.fields.getTextInputValue(SCHEDULE_FIELDS.note),
  });
  if (!parsed.success) {
    throw new UserFacingError(parsed.error.issues[0]?.message ?? 'Não entendi o formulário.', {
      code: 'VALIDATION',
    });
  }
  const draft = await ctx.squadAgenda.prepare(member, parsed.data, config);
  const { timezone } = await ctx.config.getSettings(member.guild.id);
  await interaction.editReply(visibilityPrompt(draft, new Date(), timezone));
  return true;
}

export function requestAnsweredText(result: RequestAnswerResult): string {
  switch (result.outcome) {
    case 'going':
      return `Aceito: <@${result.userId}> está na lista.`;
    case 'waiting':
      return `Aceito, mas lotou: <@${result.userId}> foi para a lista de espera.`;
    case 'rejected':
      return `Recusado. <@${result.userId}> foi avisado e pode pedir de novo.`;
  }
}

/** Pedido que não existe mais: a mensagem perde os botões em vez de repetir o erro. */
const GONE_CODES = new Set(['LFG_REQUEST_GONE', 'LFG_SESSION_CLOSED']);

/**
 * ACEITAR e RECUSAR, na DM do host ou na thread. A guild vem do `custom_id` e
 * tudo o que o gate de guild confere é conferido de novo aqui. Na DM só o host
 * responde; na thread, o host ou a staff. A resposta troca a própria mensagem,
 * sem botões, para o clique não se repetir.
 */
export async function handleSquadRequestButton(
  ctx: BotContext,
  interaction: ButtonInteraction,
): Promise<boolean> {
  const parsed = parseSquadId(interaction.customId);
  if (parsed?.kind !== 'request') return false;
  const { guildId, sessionId, userId } = parsed;
  const guild: Guild | undefined = ctx.registry.serves(guildId)
    ? ctx.client.guilds.cache.get(guildId)
    : undefined;
  if (!guild) {
    throw new UserFacingError('Esse servidor não usa mais o bot.', { code: 'GUILD_NOT_SERVED' });
  }
  await squadsConfigOrFail(ctx, guildId);
  const hostId = await ctx.squadAgenda.hostOf(guildId, sessionId);
  const actor = await guild.members
    .fetch({ user: interaction.user.id, force: true })
    .catch(() => null);
  const allowed =
    actor !== null &&
    (interaction.inGuild() ? await canManage(ctx, actor, hostId ?? '') : actor.id === hostId);
  if (hostId !== null && !allowed) {
    throw new UserFacingError('Só quem marcou a jogatina responde aos pedidos.', {
      code: 'FORBIDDEN',
    });
  }

  await interaction.deferUpdate();
  let description: string;
  try {
    if (hostId === null) {
      throw new UserFacingError('Essa jogatina já acabou ou foi cancelada.', {
        code: 'LFG_SESSION_CLOSED',
      });
    }
    const result = await ctx.squadAgenda.answer(
      guild,
      sessionId,
      userId,
      parsed.answer === 'ok',
      interaction.user.id,
    );
    description = requestAnsweredText(result);
  } catch (error) {
    if (!(error instanceof UserFacingError) || !GONE_CODES.has(error.code)) throw error;
    description = error.message;
  }
  await interaction.editReply({
    content: null,
    embeds: [infoEmbed({ title: 'Pedido de vaga', description, footer: botFooter() })],
    components: [],
  });
  return true;
}

function dmResultText(choice: SquadDmChoice, guildName: string, config: SquadsConfig): string {
  switch (choice) {
    case 'search':
      return `Em **${guildName}**: ${searchToggledText('on', config)}`;
    case 'later':
      return `Beleza. Não te aviso de novo nas próximas ${String(LFG_PROMPT_COOLDOWN_HOURS)} horas.`;
    case 'optout':
      return `Em **${guildName}**: ${optOutToggledText('on')}`;
  }
}

/**
 * Os botões da DM do aviso automático. A DM não é de servidor nenhum, então
 * tudo o que o gate de `interaction.ts` confere para interação de guild é
 * conferido aqui de novo, pela guild do `custom_id`: atendida, módulo ligado e
 * a pessoa ainda membro. A resposta troca a própria DM, sem botões, para o
 * clique não poder se repetir.
 */
export async function handleSquadDmButton(
  ctx: BotContext,
  interaction: ButtonInteraction,
): Promise<boolean> {
  const parsed = parseSquadId(interaction.customId);
  if (parsed?.kind !== 'dm') return false;
  const { guildId, choice } = parsed;
  // Erro depois daqui troca o embed e deixa os botões, para tentar de novo.
  await interaction.deferUpdate();
  const guild = ctx.registry.serves(guildId) ? ctx.client.guilds.cache.get(guildId) : undefined;
  if (!guild) {
    throw new UserFacingError('Esse servidor não usa mais o bot.', { code: 'GUILD_NOT_SERVED' });
  }
  const config = await squadsConfigOrFail(ctx, guildId);

  if (choice !== 'later') {
    const member = await guild.members
      .fetch({ user: interaction.user.id, force: true })
      .catch(() => null);
    if (!member) {
      throw new UserFacingError(`Você não está mais em **${guild.name}**.`, {
        code: 'NOT_A_MEMBER',
      });
    }
    if (choice === 'search') await ctx.squads.startSearch(member, config);
    else if (config.optOutRoleId === null || !member.roles.cache.has(config.optOutRoleId)) {
      await ctx.squads.toggleOptOut(member, config);
    }
  }

  await interaction.editReply({
    embeds: [
      infoEmbed({
        title: 'Buscar squad?',
        description: dmResultText(choice, guild.name, config),
        footer: botFooter(),
      }),
    ],
    components: [],
  });
  return true;
}
