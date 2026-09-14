import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

import {
  keepButtonId,
  leaveButtonId,
  proposalButtonId,
  requestButtonId,
  sessionButtonId,
} from './ids';
import { formatSlot } from './slots';
import { botFooter, infoEmbed } from '../../lib/embeds';

import type { Squad, SquadGame, SquadJoinRequest, SquadProposal, SquadSession } from '@goodbot/db';
import type { SquadAnswers, SquadBlockConfig } from '@goodbot/shared';
import type { APIEmbedField, BaseMessageOptions } from 'discord.js';

/**
 * Todo texto que o módulo mostra no Discord mora aqui: embeds, botões e as
 * frases curtas que os services devolvem para a resposta efêmera. Copy em
 * pt-BR, curta, sem travessão.
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
