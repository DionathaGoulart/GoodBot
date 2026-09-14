import { countCells } from '@goodbot/shared';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

import {
  confirmLeaveButtonId,
  joinButtonId,
  keepButtonId,
  leaveButtonId,
  profileStartButtonId,
  proposalButtonId,
  requestButtonId,
  sessionButtonId,
  statusButtonId,
} from './ids';
import { formatSlot } from './slots';
import { botFooter, infoEmbed } from '../../lib/embeds';

import type {
  Squad,
  SquadGame,
  SquadJoinRequest,
  SquadProfile,
  SquadProposal,
  SquadSession,
} from '@goodbot/db';
import type {
  SquadAnswers,
  SquadBlockConfig,
  SquadProfileStatus,
  SquadRequestStatus,
} from '@goodbot/shared';
import type { APIEmbedField, BaseMessageOptions } from 'discord.js';

/**
 * Todo texto que o módulo mostra no Discord mora aqui: embeds, botões e as
 * frases curtas das respostas efêmeras. A exceção são os dois formulários do
 * perfil (modal e grade), que moram em `forms.ts` junto dos componentes.
 * Copy em pt-BR, curta, sem travessão.
 */

export const SQUADS_FOOTER = botFooter('SQUADS');

/** Teto do Discord para o valor de um field. */
const MAX_FIELD_VALUE = 1024;

export const NO_VOICE_NOTE =
  'Ainda sem sala fixa: o pool de voices está cheio. No dia, usem qualquer voice livre.';
export const NO_RESERVED_VOICE_NOTE = 'Sem sala reservada desta vez: usem qualquer voice livre.';
export const LEAVE_NOTICE =
  'Você saiu do squad. Seu perfil ficou pausado: para voltar a procurar, use /squad status procurando.';
export const RENAME_LATER_NOTE =
  'O nome do canal atualiza daqui a pouco: o Discord limita quantas vezes um canal pode ser renomeado.';

const mention = (id: string) => `<@${id}>`;

function mentionList(ids: readonly string[], empty = 'ninguém'): string {
  const text = ids.length > 0 ? ids.map(mention).join(', ') : empty;
  return text.slice(0, MAX_FIELD_VALUE);
}

function timestamp(date: Date, style: 'F' | 'R' | 't'): string {
  return `<t:${String(Math.floor(date.getTime() / 1000))}:${style}>`;
}

function slotText(
  slot: { day: number; block: number } | null,
  blocks: readonly SquadBlockConfig[],
): string {
  return slot ? formatSlot(slot.day, slot.block, blocks) : 'A combinar';
}

function buttons(...list: ButtonBuilder[]): ActionRowBuilder<ButtonBuilder>[] {
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(list)];
}

// ── proposta ────────────────────────────────────────────────────────────────

export type ProposalState = 'open' | 'closed' | 'expired';

export interface ProposalView {
  proposal: Pick<SquadProposal, 'id' | 'userIds' | 'acceptedIds' | 'declinedIds' | 'expiresAt'>;
  game: Pick<SquadGame, 'name'>;
  /** A janela do squad, se já existe; senão a sugerida pelas grades. */
  slot: { day: number; block: number } | null;
  blocks: readonly SquadBlockConfig[];
  squad: Pick<Squad, 'name' | 'textChannelId'> | null;
  state: ProposalState;
  embedColor: number;
  /** `false` no primeiro envio: os botões entram depois que a linha existe. */
  withButtons?: boolean;
}

function proposalDescription(view: ProposalView): string {
  const home = view.squad
    ? `O squad **${view.squad.name}**${view.squad.textChannelId ? ` está em <#${view.squad.textChannelId}>` : ' já existe'}.`
    : null;
  switch (view.state) {
    case 'open':
      return [
        `Vocês marcaram horários parecidos para jogar **${view.game.name}**.`,
        'Quem topar jogar junto toda semana, clica em **Aceito**. O primeiro aceite cria o squad, e quem passar fica de fora sem problema.',
        home,
      ]
        .filter(Boolean)
        .join('\n\n');
    case 'closed':
      return home
        ? `Proposta encerrada. ${home}`
        : 'Proposta encerrada: ninguém topou desta vez. Seu perfil continua procurando.';
    case 'expired':
      return home
        ? `Esta proposta expirou. ${home}`
        : 'Esta proposta expirou sem nenhum aceite. Seu perfil continua procurando.';
  }
}

export function proposalMessage(view: ProposalView): BaseMessageOptions {
  const { proposal } = view;
  const decided = new Set([...proposal.acceptedIds, ...proposal.declinedIds]);
  const fields: APIEmbedField[] = [
    { name: 'Janela', value: slotText(view.slot, view.blocks) },
    { name: 'Aceitaram', value: mentionList(proposal.acceptedIds), inline: true },
    { name: 'Passaram', value: mentionList(proposal.declinedIds), inline: true },
    {
      name: 'Aguardando',
      value: mentionList(proposal.userIds.filter((id) => !decided.has(id))),
      inline: true,
    },
  ];
  if (view.state === 'open') {
    fields.push({ name: 'Prazo', value: timestamp(proposal.expiresAt, 'R') });
  }

  const embed = infoEmbed(
    {
      title: 'Proposta de squad',
      description: proposalDescription(view),
      fields,
      footer: SQUADS_FOOTER,
    },
    view.embedColor,
  );
  const open = view.state === 'open' && view.withButtons !== false;
  return {
    embeds: [embed],
    components: open
      ? buttons(
          new ButtonBuilder()
            .setCustomId(proposalButtonId('accept', proposal.id))
            .setLabel('ACEITO')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(proposalButtonId('decline', proposal.id))
            .setLabel('PASSO')
            .setStyle(ButtonStyle.Secondary),
        )
      : [],
  };
}

// ── casa do squad ───────────────────────────────────────────────────────────

export interface WelcomeView {
  squad: Pick<Squad, 'id' | 'name' | 'day' | 'block'>;
  game: Pick<SquadGame, 'name' | 'squadSize'>;
  memberIds: readonly string[];
  blocks: readonly SquadBlockConfig[];
  nextSessionAt: Date | null;
  voiceChannelId: string | null;
  embedColor: number;
}

export function squadWelcomeMessage(view: WelcomeView): BaseMessageOptions {
  const next = view.nextSessionAt
    ? `${timestamp(view.nextSessionAt, 'F')} (${timestamp(view.nextSessionAt, 'R')})`
    : 'A combinar';
  const embed = infoEmbed(
    {
      title: 'Squad formado',
      description: `Bem-vindos ao **${view.squad.name}**! Este canal é a casa do squad de ${view.game.name}: combinem tudo por aqui.`,
      fields: [
        {
          name: 'Membros',
          value: `${mentionList(view.memberIds)} (${String(view.memberIds.length)} de ${String(view.game.squadSize)})`,
        },
        { name: 'Janela semanal', value: slotText(view.squad, view.blocks), inline: true },
        { name: 'Próxima sessão', value: next, inline: true },
        {
          name: 'Sala',
          value: view.voiceChannelId
            ? `<#${view.voiceChannelId}>, reservada só para vocês durante a janela.`
            : NO_VOICE_NOTE,
        },
        {
          name: 'Como funciona',
          value:
            'Antes de cada sessão eu chamo todo mundo com Vou / Não vou. Para mudar o nome, use /squad renomear. Para sair, use /squad sair ou o botão abaixo.',
        },
      ],
      footer: SQUADS_FOOTER,
    },
    view.embedColor,
  );
  return {
    content: view.memberIds.map(mention).join(' ') || undefined,
    embeds: [embed],
    components: buttons(
      new ButtonBuilder()
        .setCustomId(leaveButtonId(view.squad.id))
        .setLabel('SAIR DO SQUAD')
        .setStyle(ButtonStyle.Secondary),
    ),
    allowedMentions: { users: [...view.memberIds] },
  };
}

export interface MembershipView {
  userId: string;
  memberCount: number;
  squadSize: number;
  embedColor: number;
}

/** "Entrou". Com `ping`, a pessoa é chamada: é assim que ela acha o canal novo. */
export function memberJoinedMessage(view: MembershipView & { ping: boolean }): BaseMessageOptions {
  const full = view.memberCount >= view.squadSize ? ' O squad está completo.' : '';
  return {
    ...(view.ping ? { content: mention(view.userId) } : {}),
    embeds: [
      infoEmbed(
        {
          title: 'Chegou reforço',
          description: `${mention(view.userId)} entrou no squad. Agora são ${String(view.memberCount)} de ${String(view.squadSize)}.${full}`,
          footer: SQUADS_FOOTER,
        },
        view.embedColor,
      ),
    ],
    allowedMentions: { users: view.ping ? [view.userId] : [] },
  };
}

export function memberLeftMessage(view: MembershipView): BaseMessageOptions {
  return {
    embeds: [
      infoEmbed(
        {
          title: 'Alguém saiu',
          description: `${mention(view.userId)} saiu do squad. Agora são ${String(view.memberCount)} de ${String(view.squadSize)}, e a vaga volta para a busca.`,
          footer: SQUADS_FOOTER,
        },
        view.embedColor,
      ),
    ],
    allowedMentions: { users: [] },
  };
}

export function archivedNoticeMessage(view: {
  squad: Pick<Squad, 'name'>;
  reason: string | null;
  embedColor: number;
}): BaseMessageOptions {
  return {
    embeds: [
      infoEmbed(
        {
          title: 'Squad arquivado',
          description: `O **${view.squad.name}** foi arquivado. O canal fica aberto só para leitura.`,
          ...(view.reason
            ? { fields: [{ name: 'Motivo', value: view.reason.slice(0, MAX_FIELD_VALUE) }] }
            : {}),
          footer: SQUADS_FOOTER,
        },
        view.embedColor,
      ),
    ],
    components: [],
    allowedMentions: { users: [] },
  };
}

// ── pedido de entrada ───────────────────────────────────────────────────────

export type JoinRequestState = 'pending' | 'accepted' | 'declined' | 'expired';

export interface JoinRequestView {
  request: Pick<SquadJoinRequest, 'id' | 'userId' | 'declinedIds' | 'decidedBy'>;
  squad: Pick<Squad, 'day' | 'block'>;
  game: Pick<SquadGame, 'fields'>;
  answers: SquadAnswers;
  blocks: readonly SquadBlockConfig[];
  memberCount: number;
  state: JoinRequestState;
  embedColor: number;
}

function answerFields(game: Pick<SquadGame, 'fields'>, answers: SquadAnswers): APIEmbedField[] {
  const fields: APIEmbedField[] = [];
  for (const field of game.fields) {
    const value = Object.hasOwn(answers, field.key) ? answers[field.key] : undefined;
    const text = Array.isArray(value) ? value.join(', ') : (value ?? '');
    if (!text) continue;
    fields.push({ name: field.label, value: text.slice(0, MAX_FIELD_VALUE), inline: true });
  }
  return fields;
}

function joinRequestDescription(view: JoinRequestView): string {
  const candidate = mention(view.request.userId);
  switch (view.state) {
    case 'pending':
      return `${candidate} procura squad e joga no horário de vocês (${formatSlot(view.squad.day, view.squad.block, view.blocks)}). Basta um de vocês aceitar.`;
    case 'accepted':
      return view.request.decidedBy
        ? `${candidate} entrou no squad. Aceito por ${mention(view.request.decidedBy)}.`
        : `${candidate} entrou no squad.`;
    case 'declined':
      return `Pedido de ${candidate} recusado pelo squad.`;
    case 'expired':
      return `Pedido de ${candidate} encerrado sem decisão.`;
  }
}

/**
 * Pedido no canal do squad. Silencioso: ninguém é pingado, e o candidato só
 * descobre quando é aceito (o canal é privado, ele nem vê esta mensagem).
 */
export function joinRequestMessage(view: JoinRequestView): BaseMessageOptions {
  const fields = answerFields(view.game, view.answers);
  if (view.state === 'pending' && view.request.declinedIds.length > 0) {
    fields.push({
      name: 'Recusas',
      value: `${String(view.request.declinedIds.length)} de ${String(view.memberCount)}`,
    });
  }
  return {
    embeds: [
      infoEmbed(
        {
          title: 'Pedido para entrar',
          description: joinRequestDescription(view),
          fields,
          footer: SQUADS_FOOTER,
        },
        view.embedColor,
      ),
    ],
    components:
      view.state === 'pending'
        ? buttons(
            new ButtonBuilder()
              .setCustomId(requestButtonId('accept', view.request.id))
              .setLabel('ACEITAR')
              .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
              .setCustomId(requestButtonId('decline', view.request.id))
              .setLabel('RECUSAR')
              .setStyle(ButtonStyle.Secondary),
          )
        : [],
    allowedMentions: { parse: [] },
  };
}

// ── sessão ──────────────────────────────────────────────────────────────────

export interface ReminderView {
  session: Pick<SquadSession, 'id' | 'startsAt' | 'endsAt' | 'goingIds' | 'notGoingIds'>;
  squad: Pick<Squad, 'name'>;
  memberIds: readonly string[];
  voiceChannelId: string | null;
  embedColor: number;
  /** Só o primeiro envio chama os membros; a edição dos votos não pinga ninguém. */
  mentionMembers: boolean;
}

export function sessionReminderMessage(view: ReminderView): BaseMessageOptions {
  const { session } = view;
  const answered = new Set([...session.goingIds, ...session.notGoingIds]);
  const embed = infoEmbed(
    {
      title: 'Sessão chegando',
      description: `A sessão do **${view.squad.name}** começa ${timestamp(session.startsAt, 'R')}, às ${timestamp(session.startsAt, 't')}. Vai jogar?`,
      fields: [
        {
          name: 'Sala',
          value: view.voiceChannelId
            ? `<#${view.voiceChannelId}>, reservada para o squad até ${timestamp(session.endsAt, 't')}.`
            : NO_RESERVED_VOICE_NOTE,
        },
        { name: 'Vão', value: mentionList(session.goingIds), inline: true },
        { name: 'Não vão', value: mentionList(session.notGoingIds), inline: true },
        {
          name: 'Sem resposta',
          value: mentionList(view.memberIds.filter((id) => !answered.has(id))),
          inline: true,
        },
      ],
      footer: SQUADS_FOOTER,
    },
    view.embedColor,
  );
  return {
    ...(view.mentionMembers ? { content: view.memberIds.map(mention).join(' ') } : {}),
    embeds: [embed],
    components: buttons(
      new ButtonBuilder()
        .setCustomId(sessionButtonId('going', session.id))
        .setLabel('VOU')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(sessionButtonId('notgoing', session.id))
        .setLabel('NÃO VOU')
        .setStyle(ButtonStyle.Secondary),
    ),
    allowedMentions: { users: view.mentionMembers ? [...view.memberIds] : [] },
  };
}

/** Na hora da sessão, para quem não está em voice nenhum (não dá para mover). */
export function sessionStartMessage(view: {
  userIds: readonly string[];
  voiceChannelId: string | null;
}): BaseMessageOptions {
  const where = view.voiceChannelId
    ? `Entrem em <#${view.voiceChannelId}>.`
    : 'Escolham um voice livre.';
  return {
    content: `${view.userIds.map(mention).join(' ')} a sessão do squad começou! ${where}`,
    allowedMentions: { users: [...view.userIds] },
  };
}

export function inactivityWarningMessage(view: {
  squad: Pick<Squad, 'id' | 'name'>;
  memberIds: readonly string[];
  weeks: number;
  embedColor: number;
}): BaseMessageOptions {
  return {
    content: view.memberIds.map(mention).join(' ') || undefined,
    embeds: [
      infoEmbed(
        {
          title: 'O squad ainda joga?',
          description: `Faz ${String(view.weeks)} semanas que ninguém confirma presença no **${view.squad.name}**. Se vocês ainda jogam, cliquem em **Ainda jogamos**. Sem resposta em 7 dias, o squad é arquivado.`,
          footer: SQUADS_FOOTER,
        },
        view.embedColor,
      ),
    ],
    components: buttons(
      new ButtonBuilder()
        .setCustomId(keepButtonId(view.squad.id))
        .setLabel('AINDA JOGAMOS')
        .setStyle(ButtonStyle.Success),
    ),
    allowedMentions: { users: [...view.memberIds] },
  };
}

// ── mensagem fixa e perfil ──────────────────────────────────────────────────

/** Teto de botões numa mensagem: cinco linhas de cinco. */
const MAX_MESSAGE_BUTTONS = 25;
const BUTTONS_PER_ROW = 5;
/** Teto do Discord para o rótulo de um botão. */
const MAX_BUTTON_LABEL = 80;

function buttonRows(list: readonly ButtonBuilder[]): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let start = 0; start < list.length; start += BUTTONS_PER_ROW) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        list.slice(start, start + BUTTONS_PER_ROW),
      ),
    );
  }
  return rows;
}

export interface SearchMessageView {
  games: readonly Pick<SquadGame, 'id' | 'name'>[];
  pingRoleId: string | null;
  embedColor: number;
}

/**
 * A mensagem fixa do canal de busca, com um botão por jogo. O cargo de ping
 * vai no conteúdo e só notifica no primeiro envio: editar a mensagem não
 * chama ninguém de novo.
 */
export function searchMessage(view: SearchMessageView): BaseMessageOptions {
  const games = view.games.slice(0, MAX_MESSAGE_BUTTONS);
  const embed = infoEmbed(
    {
      title: 'Procurar squad',
      description: [
        'Quer jogar sempre com o mesmo grupo, no mesmo horário, toda semana? Monte seu perfil no botão do jogo: responda as perguntas e marque os horários em que você costuma jogar.',
        'Eu cruzo as agendas e chamo, numa conversa privada, quem joga nos mesmos horários que você. O primeiro que aceitar cria o squad, com canal próprio e sala reservada na hora de jogar.',
      ].join('\n\n'),
      fields: [
        {
          name: 'Comandos',
          value: [
            '`/squad perfil` edita o seu perfil',
            '`/squad status` pausa ou retoma a busca',
            '`/squad procurar` mostra squads com vaga nos seus horários',
          ].join('\n'),
        },
      ],
      footer: SQUADS_FOOTER,
    },
    view.embedColor,
  );
  return {
    ...(view.pingRoleId ? { content: `<@&${view.pingRoleId}>` } : {}),
    embeds: [embed],
    components: buttonRows(
      games.map((game) =>
        new ButtonBuilder()
          .setCustomId(profileStartButtonId(game.id))
          .setLabel(`MONTAR PERFIL: ${game.name.toUpperCase()}`.slice(0, MAX_BUTTON_LABEL))
          .setStyle(ButtonStyle.Primary),
      ),
    ),
    allowedMentions: { parse: [], roles: view.pingRoleId ? [view.pingRoleId] : [] },
  };
}

const PROFILE_STATUS_TEXT: Record<SquadProfileStatus, string> = {
  searching:
    'Você está procurando squad. Quando aparecer gente que joga nos mesmos horários, eu chamo você numa conversa privada no canal de busca.',
  paused: 'Sua busca está pausada: você não recebe propostas novas até voltar a procurar.',
  in_squad:
    'Você já está num squad deste jogo, então fica fora das propostas novas. Se sair do squad, a busca fica pausada até você retomar.',
};

export interface ProfileSavedView {
  game: Pick<SquadGame, 'id' | 'name'>;
  profile: Pick<SquadProfile, 'status' | 'availability'>;
  embedColor: number;
}

/** Resposta de quem salvou a grade: o que vale agora e o botão de pausar ou retomar. */
export function profileSavedMessage(view: ProfileSavedView): BaseMessageOptions {
  const { game, profile } = view;
  const cells = countCells(profile.availability);
  const embed = infoEmbed(
    {
      title: 'Perfil salvo',
      description: `Seu perfil de **${game.name}** está salvo. ${PROFILE_STATUS_TEXT[profile.status]}`,
      fields: [
        {
          name: 'Horários',
          value:
            cells === 1 ? '1 faixa marcada na semana' : `${String(cells)} faixas marcadas na semana`,
        },
      ],
      footer: SQUADS_FOOTER,
    },
    view.embedColor,
  );
  const toggle =
    profile.status === 'searching'
      ? new ButtonBuilder()
          .setCustomId(statusButtonId('paused', game.id))
          .setLabel('PAUSAR BUSCA')
          .setStyle(ButtonStyle.Secondary)
      : profile.status === 'paused'
        ? new ButtonBuilder()
            .setCustomId(statusButtonId('searching', game.id))
            .setLabel('VOLTAR A PROCURAR')
            .setStyle(ButtonStyle.Success)
        : null;
  return { embeds: [embed], components: toggle ? buttons(toggle) : [] };
}

export function statusChangedText(status: SquadProfileStatus): string {
  switch (status) {
    case 'searching':
      return 'Busca retomada. Quando aparecer gente com horário parecido, eu chamo você.';
    case 'paused':
      return 'Busca pausada. Para voltar, use /squad status procurando.';
    case 'in_squad':
      return 'Você está num squad deste jogo, então continua fora das propostas novas.';
  }
}

/** Quantos squads o `/squad procurar` lista: um botão por squad, numa linha só. */
export const MAX_JOINABLE_LISTED = 5;

export interface JoinableView {
  game: Pick<SquadGame, 'name' | 'squadSize'>;
  entries: readonly {
    squad: Pick<Squad, 'id' | 'name' | 'day' | 'block'>;
    memberCount: number;
  }[];
  blocks: readonly SquadBlockConfig[];
  embedColor: number;
}

export function joinableSquadsMessage(view: JoinableView): BaseMessageOptions {
  const entries = view.entries.slice(0, MAX_JOINABLE_LISTED);
  if (entries.length === 0) {
    return {
      embeds: [
        infoEmbed(
          {
            title: 'Squads com vaga',
            description: `Nenhum squad de **${view.game.name}** tem vaga nos seus horários agora. Se você está procurando, eu mando seu perfil para um squad assim que abrir uma vaga que combine.`,
            footer: SQUADS_FOOTER,
          },
          view.embedColor,
        ),
      ],
      components: [],
    };
  }
  return {
    embeds: [
      infoEmbed(
        {
          title: 'Squads com vaga',
          description:
            'Estes squads têm vaga e jogam num horário que você marcou. O pedido vai para o canal do squad, e basta alguém de lá aceitar.',
          fields: entries.map((entry, index) => ({
            name: `${String(index + 1)}. ${entry.squad.name}`,
            value: `${formatSlot(entry.squad.day, entry.squad.block, view.blocks)}\n${String(entry.memberCount)} de ${String(view.game.squadSize)} jogadores`,
          })),
          footer: SQUADS_FOOTER,
        },
        view.embedColor,
      ),
    ],
    components: buttons(
      ...entries.map((entry, index) =>
        new ButtonBuilder()
          .setCustomId(joinButtonId(entry.squad.id))
          .setLabel(`PEDIR VAGA NO ${String(index + 1)}`)
          .setStyle(ButtonStyle.Primary),
      ),
    ),
  };
}

// ── respostas efêmeras ──────────────────────────────────────────────────────

const channelOf = (squad: Pick<Squad, 'textChannelId'> | null) =>
  squad?.textChannelId ? `<#${squad.textChannelId}>` : null;

export function proposalAcceptedText(result: {
  outcome: 'created' | 'joined' | 'already';
  squad: Pick<Squad, 'name' | 'textChannelId'> | null;
}): string {
  const where = channelOf(result.squad);
  switch (result.outcome) {
    case 'created':
      return where ? `Squad criado! A casa de vocês é ${where}.` : 'Squad criado!';
    case 'joined': {
      const name = result.squad ? `**${result.squad.name}**` : 'squad';
      return where ? `Você entrou no ${name}: ${where}.` : `Você entrou no ${name}.`;
    }
    case 'already':
      return where
        ? `Você já tinha aceitado. O squad está em ${where}.`
        : 'Você já tinha aceitado esta proposta.';
  }
}

export function proposalDeclinedText(outcome: 'declined' | 'already'): string {
  return outcome === 'declined'
    ? 'Anotado: você passou nesta proposta. Seu perfil continua procurando.'
    : 'Você já tinha passado nesta proposta.';
}

export function joinRequestDecisionText(
  decision:
    | { outcome: 'accepted' | 'declined' | 'recorded' }
    | { outcome: 'already'; status: SquadRequestStatus },
): string {
  switch (decision.outcome) {
    case 'accepted':
      return 'Pedido aceito. A pessoa já está no squad.';
    case 'declined':
      return 'Pedido recusado.';
    case 'recorded':
      return 'Sua recusa foi anotada. O pedido segue aberto para o resto do squad.';
    case 'already':
      if (decision.status === 'accepted') return 'Este pedido já foi aceito.';
      if (decision.status === 'declined') return 'Este pedido já foi recusado.';
      return 'Este pedido já foi encerrado.';
  }
}

export function voteText(going: boolean): string {
  return going ? 'Presença confirmada. Bom jogo!' : 'Anotado: você não vai desta vez.';
}

export const KEEP_ALIVE_TEXT = 'Anotado! O squad continua ativo.';

export function joinRequestSentText(squad: Pick<Squad, 'name'>): string {
  return `Pedido enviado ao **${squad.name}**. Se alguém de lá aceitar, você entra e é chamado no canal do squad.`;
}

export function searchMessagePublishedText(channelId: string): string {
  return `Mensagem de busca publicada em <#${channelId}>.`;
}

/** O passo de confirmação do botão de sair. */
export function leaveConfirmMessage(squadId: string): BaseMessageOptions {
  return {
    content:
      'Sair deste squad? Sua vaga volta para a busca e, se você for o último, o squad é arquivado.',
    components: buttons(
      new ButtonBuilder()
        .setCustomId(confirmLeaveButtonId(squadId))
        .setLabel('SAIR DO SQUAD')
        .setStyle(ButtonStyle.Danger),
    ),
  };
}
