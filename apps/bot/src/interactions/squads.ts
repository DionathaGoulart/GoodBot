import {
  describeWhen,
  LFG_MAX_SLOTS,
  LFG_MIN_SLOTS,
  LFG_NOTE_MAX_LENGTH,
  LFG_PROMPT_COOLDOWN_HOURS,
  LFG_WHEN_MAX_LENGTH,
  ScheduleSessionInputSchema,
  seatedEntries,
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
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

import { botFooter, infoEmbed } from '../lib/embeds';
import { levelAtLeast, resolveLevel, toMemberLike } from '../services/permissions';
import { JOIN_TEXT, LEAVE_TEXT, whenDefault } from '../services/squads/agenda';
import {
  manageId,
  parseSquadId,
  SCHEDULE_FIELDS,
  SCHEDULE_ID,
  visibilityId,
} from '../services/squads/ids';

import type { BotContext } from '../lib/command';
import type {
  MemberAgendaEntry,
  RequestAnswerResult,
  ScheduleDraft,
} from '../services/squads/agenda';
import type { ManageOp, SquadCustomId, SquadDmChoice } from '../services/squads/ids';
import type { SearchState } from '../services/squads/presence';
import type { LfgSession, LfgSessionWithRoster } from '@goodbot/db';
import type { LfgMemberStatus, SquadsConfig } from '@goodbot/shared';
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

// ── GERENCIAR ───────────────────────────────────────────────────────────────

const ROSTER_STATUS: Record<LfgMemberStatus, string> = {
  host: 'marcou',
  going: 'vai',
  waiting: 'na lista de espera',
  requested: 'pediu vaga',
};

/** Quantas pessoas o select de TIRAR ALGUÉM mostra: o teto do Discord. */
const KICK_OPTIONS_MAX = 25;

/**
 * O painel efêmero do GERENCIAR: o resumo, os botões e o select de TIRAR
 * ALGUÉM. `status` é a linha do que acabou de acontecer. `embeds: []` limpa o
 * embed de erro que uma tentativa anterior tenha deixado na mesma mensagem.
 */
export function managePanel(
  { session, roster }: LfgSessionWithRoster,
  nameOf: (userId: string) => string,
  status?: string,
) {
  const at = String(Math.floor(session.startsAt.getTime() / 1000));
  const seated = seatedEntries(roster).length;
  const counts = [
    `${String(seated)}/${String(roster.slots)} vagas`,
    roster.visibility === 'open' ? 'aberta' : 'fechada',
  ];
  const waiting = roster.entries.filter((entry) => entry.status === 'waiting').length;
  const requested = roster.entries.filter((entry) => entry.status === 'requested').length;
  if (waiting > 0) counts.push(`${String(waiting)} na espera`);
  if (requested > 0) counts.push(`${String(requested)} ${requested === 1 ? 'pedido' : 'pedidos'}`);

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(manageId('when', session.id))
      .setLabel('REMARCAR')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(manageId('slots', session.id))
      .setLabel('VAGAS')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(manageId('vis', session.id))
      .setLabel(roster.visibility === 'open' ? 'FECHAR' : 'ABRIR')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(manageId('cancel', session.id))
      .setLabel('CANCELAR')
      .setStyle(ButtonStyle.Danger),
  );
  const others = roster.entries
    .filter((entry) => entry.status !== 'host')
    .slice(0, KICK_OPTIONS_MAX);
  const components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [buttons];
  if (others.length > 0) {
    components.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(manageId('kick', session.id))
          .setPlaceholder('TIRAR ALGUÉM')
          .addOptions(
            others.map((entry) => ({
              label: nameOf(entry.userId).slice(0, 100),
              value: entry.userId,
              description: ROSTER_STATUS[entry.status],
            })),
          ),
      ),
    );
  }
  return {
    content:
      `**Gerenciar jogatina** de <t:${at}:F> (<t:${at}:R>)\n${counts.join(' · ')}` +
      (status ? `\n\n${status}` : ''),
    embeds: [],
    components,
    allowedMentions: { parse: [] },
  };
}

/** A confirmação do CANCELAR, no lugar do painel. VOLTAR refaz o painel. */
export function cancelPrompt(session: Pick<LfgSession, 'id' | 'startsAt'>) {
  const at = String(Math.floor(session.startsAt.getTime() / 1000));
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(manageId('cancelok', session.id))
      .setLabel('CANCELAR JOGATINA')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(manageId('home', session.id))
      .setLabel('VOLTAR')
      .setStyle(ButtonStyle.Secondary),
  );
  return {
    content:
      `Cancelar a jogatina de <t:${at}:F>? Quem está na lista é avisado na thread, ` +
      'e a mensagem da agenda fecha. Não dá para desfazer.',
    embeds: [],
    components: [row],
  };
}

/** O REMARCAR já abre com a hora e a nota atuais. */
export function rescheduleModal(
  session: Pick<LfgSession, 'id' | 'startsAt' | 'note'>,
  timeZone: string,
): ModalBuilder {
  const note = new TextInputBuilder()
    .setCustomId(SCHEDULE_FIELDS.note)
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(LFG_NOTE_MAX_LENGTH)
    .setRequired(false);
  if (session.note) note.setValue(session.note);
  return new ModalBuilder()
    .setCustomId(manageId('when', session.id))
    .setTitle('Remarcar jogatina')
    .setLabelComponents(
      new LabelBuilder()
        .setLabel('Quando')
        .setDescription(`No horário do servidor. Exemplos: ${WHEN_EXAMPLES}.`)
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(SCHEDULE_FIELDS.when)
            .setStyle(TextInputStyle.Short)
            .setValue(whenDefault(session.startsAt, timeZone))
            .setMaxLength(LFG_WHEN_MAX_LENGTH)
            .setRequired(true),
        ),
      new LabelBuilder()
        .setLabel('Nota')
        .setDescription('O que vão jogar, dificuldade, o que precisar saber.')
        .setTextInputComponent(note),
    );
}

export function slotsModal(session: Pick<LfgSession, 'id' | 'slots'>): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(manageId('slots', session.id))
    .setTitle('Vagas da jogatina')
    .setLabelComponents(
      new LabelBuilder()
        .setLabel('Vagas')
        .setDescription(
          `De ${String(LFG_MIN_SLOTS)} a ${String(LFG_MAX_SLOTS)}, contando quem marcou.`,
        )
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(SCHEDULE_FIELDS.slots)
            .setStyle(TextInputStyle.Short)
            .setValue(String(session.slots))
            .setMaxLength(2)
            .setRequired(true),
        ),
    );
}

/** A jogatina que o GERENCIAR vai mexer, conferindo a cada clique quem pode. */
async function managedSession(
  ctx: BotContext,
  member: GuildMember,
  sessionId: string,
): Promise<LfgSessionWithRoster> {
  await squadsConfigOrFail(ctx, member.guild.id);
  const found = await ctx.squadAgenda.manageable(member.guild.id, sessionId);
  if (!(await canManage(ctx, member, found.session.hostId))) {
    throw new UserFacingError('Só quem marcou a jogatina ou a staff gerencia.', {
      code: 'FORBIDDEN',
    });
  }
  return found;
}

function nameIn(guild: Guild): (userId: string) => string {
  return (userId) => guild.members.cache.get(userId)?.displayName ?? userId;
}

/** O painel refeito do banco depois de uma ação; a jogatina que fechou vira só o texto. */
async function panelAfter(ctx: BotContext, guild: Guild, sessionId: string, status: string) {
  try {
    const found = await ctx.squadAgenda.manageable(guild.id, sessionId);
    return managePanel(found, nameIn(guild), status);
  } catch (error) {
    if (!(error instanceof UserFacingError)) throw error;
    return { content: `${status}\n\n${error.message}`, embeds: [], components: [] };
  }
}

async function handleManage(
  ctx: BotContext,
  interaction: MessageComponentInteraction,
  member: GuildMember,
  sessionId: string,
  op: ManageOp | 'open',
): Promise<boolean> {
  const guild = member.guild;
  const found = await managedSession(ctx, member, sessionId);
  switch (op) {
    case 'open':
      await interaction.reply({
        ...managePanel(found, nameIn(guild)),
        flags: MessageFlags.Ephemeral,
      });
      return true;
    case 'home':
      await interaction.update(managePanel(found, nameIn(guild)));
      return true;
    case 'when': {
      const { timezone } = await ctx.config.getSettings(guild.id);
      await interaction.showModal(rescheduleModal(found.session, timezone));
      return true;
    }
    case 'slots':
      await interaction.showModal(slotsModal(found.session));
      return true;
    case 'cancel':
      await interaction.update(cancelPrompt(found.session));
      return true;
    case 'cancelok':
      await interaction.deferUpdate();
      await ctx.squadAgenda.cancel(guild, sessionId, member.id);
      await interaction.editReply({
        content: 'Jogatina cancelada. Avisei na thread quem estava na lista.',
        embeds: [],
        components: [],
      });
      return true;
    case 'vis': {
      await interaction.deferUpdate();
      const { visibility, accepted } = await ctx.squadAgenda.toggleVisibility(
        guild,
        sessionId,
        member.id,
      );
      const status =
        visibility === 'closed'
          ? 'Fechada: os próximos pedidos de vaga chegam na DM de quem marcou.'
          : accepted > 0
            ? `Aberta: quem clicar em VOU entra na hora, e ${accepted === 1 ? 'o pedido pendente foi aceito' : `os ${String(accepted)} pedidos pendentes foram aceitos`}.`
            : 'Aberta: quem clicar em VOU entra na hora.';
      await interaction.editReply(await panelAfter(ctx, guild, sessionId, status));
      return true;
    }
    case 'kick': {
      if (!interaction.isStringSelectMenu()) return false;
      const userId = interaction.values[0];
      if (!userId) return false;
      await interaction.deferUpdate();
      await ctx.squadAgenda.kick(guild, sessionId, userId, member.id);
      const status = `${nameIn(guild)(userId)} saiu da jogatina.`;
      await interaction.editReply(await panelAfter(ctx, guild, sessionId, status));
      return true;
    }
  }
}

/** Os modais do GERENCIAR: REMARCAR e VAGAS. A resposta refaz o painel de onde vieram. */
async function handleManageModal(
  ctx: BotContext,
  interaction: ModalSubmitInteraction,
  sessionId: string,
  op: ManageOp,
): Promise<boolean> {
  if (op !== 'when' && op !== 'slots') return false;
  const member = memberOf(interaction);
  const guild = member.guild;
  if (interaction.isFromMessage()) await interaction.deferUpdate();
  else await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await managedSession(ctx, member, sessionId);

  let status: string;
  if (op === 'when') {
    const parsed = ScheduleSessionInputSchema.pick({ when: true, note: true }).safeParse({
      when: interaction.fields.getTextInputValue(SCHEDULE_FIELDS.when),
      note: interaction.fields.getTextInputValue(SCHEDULE_FIELDS.note),
    });
    if (!parsed.success) {
      throw new UserFacingError(parsed.error.issues[0]?.message ?? 'Não entendi o formulário.', {
        code: 'VALIDATION',
      });
    }
    const session = await ctx.squadAgenda.reschedule(guild, sessionId, parsed.data, member.id);
    const at = String(Math.floor(session.startsAt.getTime() / 1000));
    status = `Remarcada para <t:${at}:F>. Avisei na thread.`;
  } else {
    const parsed = ScheduleSessionInputSchema.shape.slots.safeParse(
      interaction.fields.getTextInputValue(SCHEDULE_FIELDS.slots),
    );
    if (!parsed.success || parsed.data === undefined) {
      throw new UserFacingError(
        parsed.error?.issues[0]?.message ??
          `Vagas é um número de ${String(LFG_MIN_SLOTS)} a ${String(LFG_MAX_SLOTS)}.`,
        { code: 'VALIDATION' },
      );
    }
    await ctx.squadAgenda.setSlots(guild, sessionId, parsed.data, member.id);
    status = `Agora são ${String(parsed.data)} vagas.`;
  }
  await interaction.editReply(await panelAfter(ctx, guild, sessionId, status));
  return true;
}

const MINE_STATUS: Record<LfgMemberStatus, string> = {
  host: 'você marcou',
  going: 'você vai',
  waiting: 'você está na lista de espera',
  requested: 'seu pedido está com quem marcou',
};

/** O `/squad agenda`: as jogatinas em que a pessoa está, com o link de cada uma. */
export function mineText(entries: readonly MemberAgendaEntry[]): string {
  if (entries.length === 0) {
    return 'Você não está em nenhuma jogatina marcada. Para marcar uma, use `/squad agendar`.';
  }
  const lines = entries.map((entry) => {
    const at = String(Math.floor(entry.startsAt.getTime() / 1000));
    const link = entry.url ? ` · [ver](${entry.url})` : '';
    return `- <t:${at}:F> (<t:${at}:R>): ${MINE_STATUS[entry.status]}${link}`;
  });
  return `**Suas jogatinas**\n${lines.join('\n')}`;
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
  if (!parsed || parsed.kind === 'dm') {
    await interaction.reply({ content: STALE_FLOW_TEXT, flags: MessageFlags.Ephemeral });
    return true;
  }
  // O GERENCIAR é o único com select (TIRAR ALGUÉM); ele confere o tipo por conta própria.
  if (parsed.kind === 'manage') {
    return handleManage(ctx, interaction, memberOf(interaction), parsed.sessionId, parsed.op);
  }
  if (!interaction.isButton()) {
    await interaction.reply({ content: STALE_FLOW_TEXT, flags: MessageFlags.Ephemeral });
    return true;
  }
  if (parsed.kind === 'request') return handleSquadRequestButton(ctx, interaction);
  const member = memberOf(interaction);
  const guildId = member.guild.id;
  if (parsed.kind === 'agenda' && parsed.action === 'manage') {
    return handleManage(ctx, interaction, member, parsed.sessionId, 'open');
  }
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
  const parsed = parseSquadId(interaction.customId);
  if (parsed?.kind === 'manage') {
    return handleManageModal(ctx, interaction, parsed.sessionId, parsed.op);
  }
  if (parsed?.kind !== 'schedule') return false;
  const member = memberOf(interaction);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const config = await squadsConfigOrFail(ctx, member.guild.id);
  const input = ScheduleSessionInputSchema.omit({ visibility: true }).safeParse({
    when: interaction.fields.getTextInputValue(SCHEDULE_FIELDS.when),
    slots: interaction.fields.getTextInputValue(SCHEDULE_FIELDS.slots),
    note: interaction.fields.getTextInputValue(SCHEDULE_FIELDS.note),
  });
  if (!input.success) {
    throw new UserFacingError(input.error.issues[0]?.message ?? 'Não entendi o formulário.', {
      code: 'VALIDATION',
    });
  }
  const draft = await ctx.squadAgenda.prepare(member, input.data, config);
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
