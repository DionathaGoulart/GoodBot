import { countCells, tallyJoinVote } from '@goodbot/shared';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, UserSelectMenuBuilder } from 'discord.js';

import {
  boraButtonId,
  callButtonId,
  callNextButtonId,
  confirmLeaveButtonId,
  enterButtonId,
  inviteButtonId,
  invitePickButtonId,
  inviteUserSelectId,
  joinButtonId,
  keepButtonId,
  leaveButtonId,
  profileStartButtonId,
  proposalButtonId,
  renameButtonId,
  requestButtonId,
  searchButtonId,
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
  SquadCell,
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
  'Sem sala preferida: o pool de voices está cheio. Na jogatina eu reservo o voice que estiver livre.';
export const NO_RESERVED_VOICE_NOTE = 'Sem sala reservada desta vez: usem qualquer voice livre.';
/** O voice temporário some sozinho; quem está na jogatina precisa saber disso antes. */
export const TEMPORARY_VOICE_NOTE =
  'criada só para esta jogatina, some quando esvaziar depois do início';

/** Teto do Discord para o nome de um canal. */
const MAX_CHANNEL_NAME = 100;

/**
 * Nome do voice criado quando o pool está cheio. Ele nunca é renomeado (o
 * Discord só deixa renomear duas vezes a cada dez minutos), então o nome é o
 * do squad na hora da criação.
 */
export function temporaryVoiceName(squadName: string): string {
  return `Jogatina · ${squadName}`.slice(0, MAX_CHANNEL_NAME);
}
/** Quantas jogatinas o guia lista; o resto vira "e mais N". */
export const GUIDE_SESSIONS_LISTED = 3;
export const LEAVE_NOTICE =
  'Você saiu do squad. Seu perfil ficou pausado: para voltar a procurar, use /squad status procurando.';
export const RENAME_LATER_NOTE =
  'O nome do canal atualiza daqui a pouco: o Discord limita quantas vezes um canal pode ser renomeado.';

const mention = (id: string) => `<@${id}>`;

function mentionList(ids: readonly string[], empty = 'ninguém'): string {
  const text = ids.length > 0 ? ids.map(mention).join(', ') : empty;
  return text.slice(0, MAX_FIELD_VALUE);
}

function timestamp(date: Date, style: 'F' | 'f' | 'R' | 't'): string {
  return `<t:${String(Math.floor(date.getTime() / 1000))}:${style}>`;
}

function slotText(
  slot: { day: number; block: number } | null,
  blocks: readonly SquadBlockConfig[],
): string {
  return slot ? formatSlot(slot.day, slot.block, blocks) : 'Horários variados';
}

function buttons(...list: ButtonBuilder[]): ActionRowBuilder<ButtonBuilder>[] {
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(list)];
}

// ── proposta ────────────────────────────────────────────────────────────────

export type ProposalState = 'open' | 'closed' | 'expired';

export interface ProposalView {
  proposal: Pick<SquadProposal, 'id' | 'userIds' | 'acceptedIds' | 'declinedIds' | 'expiresAt'>;
  game: Pick<SquadGame, 'name'>;
  /** A célula com mais gente da turma: informativo, o squad não tem horário fixo. */
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
        'Quem topar formar um squad fixo, clica em **Aceito**. O primeiro aceite cria o squad, com canal próprio, e quem passar fica de fora sem problema. Depois é só marcar as jogatinas por lá.',
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
    { name: 'Vocês batem em', value: slotText(view.slot, view.blocks) },
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

export interface GuideView {
  squad: Pick<Squad, 'id' | 'name' | 'status' | 'voiceChannelId'>;
  game: Pick<SquadGame, 'id' | 'name' | 'groupSize' | 'partySize'>;
  memberIds: readonly string[];
  /** Jogatinas não canceladas que ainda não acabaram, da mais próxima. */
  upcoming: readonly Pick<SquadSession, 'startsAt' | 'goingIds'>[];
  /** O servidor deixa estar em mais de um squad: o guia oferece procurar outro. */
  canJoinAnother: boolean;
  history: GuideHistory;
  embedColor: number;
  /** Só a publicação na criação do squad chama os membros; reedição nunca pinga. */
  mentionMembers: boolean;
}

/** O histórico como o guia mostra: a frase e quem mais aparece. */
export interface GuideHistory {
  /** `formatHistory`. */
  text: string;
  /** Os mais presentes, do mais presente; vazio = ninguém ainda. */
  regularIds: readonly string[];
}

/** Quantos frequentes o guia cita. */
export const GUIDE_REGULARS_LISTED = 3;

function historyText(history: GuideHistory): string {
  const regulars = history.regularIds.slice(0, GUIDE_REGULARS_LISTED);
  return regulars.length > 0
    ? `${history.text}\nQuem mais aparece: ${mentionList(regulars)}.`
    : history.text;
}

function upcomingText(upcoming: GuideView['upcoming']): string {
  if (upcoming.length === 0) return 'Nenhuma marcada. Aperte **BORA** para chamar o squad.';
  const lines = upcoming.slice(0, GUIDE_SESSIONS_LISTED).map((session) => {
    const going = session.goingIds.length;
    const who =
      going === 0 ? 'ninguém confirmou ainda' : going === 1 ? '1 vai' : `${String(going)} vão`;
    return `${timestamp(session.startsAt, 'f')} (${timestamp(session.startsAt, 'R')}), ${who}`;
  });
  const rest = upcoming.length - GUIDE_SESSIONS_LISTED;
  if (rest > 0) lines.push(`e mais ${String(rest)}`);
  return lines.join('\n');
}

const GUIDE_HOW_TO = [
  '• Quer jogar? Aperte **BORA** ou use `/bora hoje 21h`. Eu chamo o squad, reservo uma sala um pouco antes e, na hora, puxo quem estiver em outro voice.',
  '• Na mensagem da jogatina tem **VOU**, **NÃO VOU** e **CANCELAR**. Depois que ela começa, **REPETIR** marca a mesma hora na semana seguinte.',
  '• Falta gente na party? **CHAMAR GENTE** anuncia a próxima jogatina no canal de busca, e quem quiser jogar pede para entrar.',
  '• Amigo de fora? **CONVIDAR** ou `/squad convidar`: quem vocês chamam entra sem votação. Quem chega pela busca passa pelo voto de vocês.',
  '• Nome do squad: **RENOMEAR**. Para sair: **SAIR DO SQUAD**.',
].join('\n');

/**
 * O guia fixo do canal do squad: quem está, o que vem aí e os botões de tudo o
 * que se faz no squad. O bot pina e reedita esta mensagem a cada mudança, então
 * ela é sempre o retrato de agora. Arquivado, sobra o aviso sem botões.
 */
export function guideMessage(view: GuideView): BaseMessageOptions {
  const { squad, game, memberIds } = view;
  if (squad.status === 'archived') {
    return {
      content: '',
      embeds: [
        infoEmbed(
          {
            title: `${squad.name} (arquivado)`,
            description: `Este squad de ${game.name} foi arquivado. O canal fica aberto só para leitura.`,
            footer: SQUADS_FOOTER,
          },
          view.embedColor,
        ),
      ],
      components: [],
      allowedMentions: { parse: [] },
    };
  }

  const open = game.groupSize - memberIds.length;
  const parties =
    game.partySize < game.groupSize
      ? ` Cada partida leva até ${String(game.partySize)}: quando vier mais gente, eu aviso para dividirem.`
      : '';
  const embed = infoEmbed(
    {
      title: squad.name,
      description: `Casa do squad de **${game.name}**. Combinem tudo por aqui.${parties}`,
      fields: [
        {
          name: `Membros (${String(memberIds.length)} de ${String(game.groupSize)})`,
          value: mentionList(memberIds),
        },
        {
          name: 'Vagas',
          value:
            open > 0
              ? `${open === 1 ? '1 aberta' : `${String(open)} abertas`}. Quando aparecer gente com horário parecido, eu convido e vocês votam aqui.`
              : 'Squad completo.',
        },
        {
          name: 'Sala preferida',
          value: squad.voiceChannelId ? `<#${squad.voiceChannelId}>` : NO_VOICE_NOTE,
        },
        { name: 'Próximas jogatinas', value: upcomingText(view.upcoming) },
        { name: 'Histórico', value: historyText(view.history).slice(0, MAX_FIELD_VALUE) },
        { name: 'Como usar', value: GUIDE_HOW_TO },
      ],
      footer: SQUADS_FOOTER,
    },
    view.embedColor,
  );

  // Duas linhas: jogar junto em cima, cuidar do squad embaixo. Seis botões
  // não cabem numa linha (o teto do Discord é cinco).
  const play = [
    new ButtonBuilder()
      .setCustomId(boraButtonId(squad.id))
      .setLabel('BORA')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(callNextButtonId(squad.id))
      .setLabel('CHAMAR GENTE')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(invitePickButtonId(squad.id))
      .setLabel('CONVIDAR')
      .setStyle(ButtonStyle.Secondary),
  ];
  const manage = [
    new ButtonBuilder()
      .setCustomId(renameButtonId(squad.id))
      .setLabel('RENOMEAR')
      .setStyle(ButtonStyle.Secondary),
  ];
  if (view.canJoinAnother) {
    manage.push(
      new ButtonBuilder()
        .setCustomId(searchButtonId(game.id))
        .setLabel('PROCURAR OUTRO SQUAD')
        .setStyle(ButtonStyle.Secondary),
    );
  }
  manage.push(
    new ButtonBuilder()
      .setCustomId(leaveButtonId(squad.id))
      .setLabel('SAIR DO SQUAD')
      .setStyle(ButtonStyle.Secondary),
  );

  const mentioned = view.mentionMembers ? [...memberIds] : [];
  return {
    content: mentioned.map(mention).join(' '),
    embeds: [embed],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(play),
      new ActionRowBuilder<ButtonBuilder>().addComponents(manage),
    ],
    allowedMentions: { users: mentioned },
  };
}

export interface MembershipView {
  userId: string;
  memberCount: number;
  groupSize: number;
  embedColor: number;
}

/** "Entrou". Com `ping`, a pessoa é chamada: é assim que ela acha o canal novo. */
export function memberJoinedMessage(view: MembershipView & { ping: boolean }): BaseMessageOptions {
  const full = view.memberCount >= view.groupSize ? ' O squad está completo.' : '';
  return {
    ...(view.ping ? { content: mention(view.userId) } : {}),
    embeds: [
      infoEmbed(
        {
          title: 'Chegou reforço',
          description: `${mention(view.userId)} entrou no squad. Agora são ${String(view.memberCount)} de ${String(view.groupSize)}.${full}`,
          footer: SQUADS_FOOTER,
        },
        view.embedColor,
      ),
    ],
    allowedMentions: { users: view.ping ? [view.userId] : [] },
  };
}

/**
 * "Saiu". Quando a staff tirou a pessoa pelo painel, o canal fica sabendo que
 * foi a staff, mas nunca o motivo nem quem clicou: o canal é dos outros
 * membros, e o motivo é só da pessoa (por DM) e da auditoria.
 */
export function memberLeftMessage(
  view: MembershipView & { byStaff?: boolean },
): BaseMessageOptions {
  const who = view.byStaff
    ? `A staff tirou ${mention(view.userId)} do squad pelo painel.`
    : `${mention(view.userId)} saiu do squad.`;
  return {
    embeds: [
      infoEmbed(
        {
          title: 'Alguém saiu',
          description: `${who} Agora são ${String(view.memberCount)} de ${String(view.groupSize)}, e a vaga volta para a busca.`,
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

// ── match manual e aviso de admin ───────────────────────────────────────────

/**
 * A nota que a proposta manual deixa na thread. O admin é citado sem ser
 * chamado: sem o ping ele não recebe notificação nem é puxado para a thread.
 */
export function manualProposalNote(actorId: string): BaseMessageOptions {
  return {
    content: `Esta turma foi escolhida por ${mention(actorId)} no painel. Vale o de sempre: **Aceito** para jogar junto, **Passo** para ficar de fora.`,
    allowedMentions: { users: [] },
  };
}

export type AdminDmKind = 'paused' | 'resumed' | 'answers' | 'deleted' | 'removed';

export interface AdminDmView {
  kind: AdminDmKind;
  guildName: string;
  game: Pick<SquadGame, 'name'>;
  /** Só em `removed`. */
  squad?: Pick<Squad, 'name'>;
  /** Só em `removed`: o status do perfil depois da saída. */
  profileStatus?: SquadProfileStatus | null;
  /** Já validado pelo `SquadAdminReasonSchema`. */
  reason: string;
  embedColor: number;
}

const ADMIN_DM_TITLE: Record<AdminDmKind, string> = {
  paused: 'Sua busca de squad foi pausada',
  resumed: 'Sua busca de squad voltou',
  answers: 'Suas respostas de squad mudaram',
  deleted: 'Seu perfil de squad foi apagado',
  removed: 'Você saiu de um squad',
};

/** O que aconteceu e, num parágrafo à parte, o que fazer a seguir. */
function adminDmDescription(view: AdminDmView): string {
  const staff = `A staff de **${view.guildName}**`;
  const game = `**${view.game.name}**`;
  switch (view.kind) {
    case 'paused':
      return [
        `${staff} pausou sua busca de squad em ${game}. Enquanto ela estiver pausada, você não recebe propostas novas.`,
        'Para voltar a procurar, use /squad status procurando no servidor.',
      ].join('\n\n');
    case 'resumed':
      return [
        `${staff} retomou sua busca de squad em ${game}. Quando aparecer gente com horário parecido, eu chamo você.`,
        'Se não quiser procurar agora, use /squad status pausado no servidor.',
      ].join('\n\n');
    case 'answers':
      return [
        `${staff} editou as respostas do seu perfil de squad em ${game}. Seus horários continuam os mesmos.`,
        'Para conferir ou corrigir, use /squad perfil no servidor.',
      ].join('\n\n');
    case 'deleted':
      return [
        `${staff} apagou seu perfil de squad em ${game}, com respostas e horários. Você saiu da busca desse jogo.`,
        'Se quiser voltar, monte o perfil de novo com /squad perfil no servidor.',
      ].join('\n\n');
    case 'removed':
      return [
        `${staff} tirou você do squad **${view.squad?.name ?? 'sem nome'}** de ${game}, e você não vê mais o canal dele.`,
        view.profileStatus === 'paused'
          ? 'Seu perfil ficou pausado. Para voltar a procurar, use /squad status procurando.'
          : 'Para achar um squad com vaga, use /squad procurar.',
      ].join('\n\n');
  }
}

/**
 * A DM de quem sofreu uma ação de admin pelo painel. Diz "a staff" e nunca o
 * nome de quem clicou (a auditoria guarda); o motivo vai como o admin
 * escreveu, e ninguém é mencionado.
 */
export function adminActionDm(view: AdminDmView): BaseMessageOptions {
  return {
    embeds: [
      infoEmbed(
        {
          title: ADMIN_DM_TITLE[view.kind],
          description: adminDmDescription(view),
          fields: [{ name: 'Motivo', value: view.reason.slice(0, MAX_FIELD_VALUE) }],
          footer: SQUADS_FOOTER,
        },
        view.embedColor,
      ),
    ],
    allowedMentions: { parse: [] },
  };
}

// ── entrada num squad existente ─────────────────────────────────────────────

/**
 * Em que pé está o convite, visto por quem foi convidado. `refused` junta a
 * recusa do squad e a votação que venceu sem aprovação; `closed` é a vaga que
 * sumiu antes (squad cheio ou arquivado, ou a pessoa no teto de squads).
 */
export type InviteState =
  | 'invited'
  | 'voting'
  | 'joined'
  | 'passed'
  | 'refused'
  | 'expired'
  | 'closed';

export interface InviteView {
  request: Pick<SquadJoinRequest, 'id' | 'userId' | 'invitedBy' | 'expiresAt'>;
  squad: Pick<Squad, 'name' | 'textChannelId'>;
  game: Pick<SquadGame, 'name' | 'groupSize'>;
  memberIds: readonly string[];
  /** `formatHistory` do squad: é o que diz ao candidato se o squad joga de verdade. */
  history: string;
  state: InviteState;
  embedColor: number;
  /** Só o primeiro envio chama o candidato; a reedição não pinga. */
  mentionCandidate: boolean;
}

function inviteDescription(view: InviteView): string {
  const squad = `**${view.squad.name}**`;
  switch (view.state) {
    case 'invited':
      return view.request.invitedBy
        ? `${mention(view.request.invitedBy)} chamou você para o squad ${squad} de **${view.game.name}**. Aperte **ENTRAR** e você já está dentro.`
        : `O squad ${squad} de **${view.game.name}** tem vaga e joga em horários parecidos com os seus. Quer entrar? Aperte **ENTRAR** e o squad vota: com metade dele a favor, você entra.`;
    case 'voting':
      return `Pedido enviado ao ${squad}. O squad está votando, e eu aviso aqui quando decidirem.`;
    case 'joined': {
      const where = channelOf(view.squad);
      return where ? `Você entrou no ${squad}. A casa do squad é ${where}.` : `Você entrou no ${squad}.`;
    }
    case 'passed':
      return `Você passou neste convite para o ${squad}.`;
    case 'refused':
      return `Não rolou desta vez: o ${squad} não abriu a vaga para você.`;
    case 'expired':
      return `Este convite para o ${squad} expirou sem resposta.`;
    case 'closed':
      return `Este convite foi encerrado: a vaga no ${squad} não está mais disponível.`;
  }
}

/**
 * O convite na thread privada do candidato (a fase 1 da entrada). Mostra o
 * squad, quem está nele e o prazo; os membros aparecem sem ser chamados.
 */
export function inviteMessage(view: InviteView): BaseMessageOptions {
  const live = view.state === 'invited' || view.state === 'voting';
  const fields: APIEmbedField[] = [];
  if (live) {
    fields.push(
      { name: 'Membros', value: mentionList(view.memberIds) },
      {
        name: 'Tamanho',
        value: `${String(view.memberIds.length)} de ${String(view.game.groupSize)} jogadores`,
        inline: true,
      },
      { name: 'Prazo', value: timestamp(view.request.expiresAt, 'R'), inline: true },
      { name: 'Histórico', value: view.history.slice(0, MAX_FIELD_VALUE) },
    );
  }
  const mentioned = view.mentionCandidate ? [view.request.userId] : [];
  return {
    content: mentioned.map(mention).join(' '),
    embeds: [
      infoEmbed(
        {
          title: 'Convite para squad',
          description: inviteDescription(view),
          ...(fields.length > 0 ? { fields } : {}),
          footer: SQUADS_FOOTER,
        },
        view.embedColor,
      ),
    ],
    components:
      view.state === 'invited'
        ? buttons(
            new ButtonBuilder()
              .setCustomId(inviteButtonId('accept', view.request.id))
              .setLabel('ENTRAR')
              .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
              .setCustomId(inviteButtonId('pass', view.request.id))
              .setLabel('PASSO')
              .setStyle(ButtonStyle.Secondary),
          )
        : [],
    allowedMentions: { users: mentioned },
  };
}

/**
 * O fim da votação para quem esperava por ela, na thread do convite. É uma
 * mensagem à parte porque editar o convite não notifica ninguém.
 */
export function candidateNoticeMessage(view: {
  userId: string;
  squad: Pick<Squad, 'name'>;
  state: 'refused' | 'closed';
}): BaseMessageOptions {
  const text =
    view.state === 'refused'
      ? `não rolou desta vez: o **${view.squad.name}** não abriu a vaga para você.`
      : `a vaga no **${view.squad.name}** não está mais disponível, então o pedido foi encerrado.`;
  return {
    content: `${mention(view.userId)} ${text}`,
    allowedMentions: { users: [view.userId] },
  };
}

export type JoinVoteState = 'open' | 'accepted' | 'declined' | 'expired' | 'closed';

export interface JoinVoteView {
  request: Pick<SquadJoinRequest, 'id' | 'userId' | 'acceptedIds' | 'declinedIds' | 'expiresAt'>;
  memberIds: readonly string[];
  game: Pick<SquadGame, 'fields'>;
  answers: SquadAnswers;
  /** A célula em que o candidato joga com mais membros; `null` = nenhuma em comum. */
  slot: SquadCell | null;
  /** A jogatina cuja chamada pública trouxe o candidato; `null` = veio da busca. */
  session: Pick<SquadSession, 'startsAt'> | null;
  blocks: readonly SquadBlockConfig[];
  state: JoinVoteState;
  embedColor: number;
  /** Só o primeiro envio chama os membros; o voto reedita sem pingar. */
  mentionMembers: boolean;
}

/** Respostas de `select` e `tags`. Texto livre fica de fora: é do perfil, não da votação. */
function answerFields(game: Pick<SquadGame, 'fields'>, answers: SquadAnswers): APIEmbedField[] {
  const fields: APIEmbedField[] = [];
  for (const field of game.fields) {
    if (field.type === 'text') continue;
    const value = Object.hasOwn(answers, field.key) ? answers[field.key] : undefined;
    const text = Array.isArray(value) ? value.join(', ') : (value ?? '');
    if (!text) continue;
    fields.push({ name: field.label, value: text.slice(0, MAX_FIELD_VALUE), inline: true });
  }
  return fields;
}

function joinVoteDescription(view: JoinVoteView): string {
  const candidate = mention(view.request.userId);
  switch (view.state) {
    case 'open': {
      const who = view.session
        ? `${candidate} respondeu à chamada da jogatina de ${timestamp(view.session.startsAt, 'f')} e quer entrar no squad.`
        : `${candidate} quer entrar no squad e joga em horários parecidos com os de vocês.`;
      return `${who} Votem aqui: com metade do squad a favor, entra. Se o prazo acabar, decide quem votou.`;
    }
    case 'accepted':
      return `${candidate} entrou no squad pelo voto de vocês.`;
    case 'declined':
      return `O squad recusou a entrada de ${candidate}.`;
    case 'expired':
      return `A votação sobre ${candidate} acabou no prazo sem aprovação.`;
    case 'closed':
      return `A votação sobre ${candidate} foi encerrada: a vaga não está mais disponível.`;
  }
}

/**
 * A votação no canal do squad (a fase 2 da entrada), com a contagem viva. Quem
 * votou o quê não aparece, só quantos: o voto é de cada um.
 */
export function joinVoteMessage(view: JoinVoteView): BaseMessageOptions {
  const { request } = view;
  const tally = tallyJoinVote({
    memberIds: view.memberIds,
    forIds: request.acceptedIds,
    againstIds: request.declinedIds,
  });
  const fields = answerFields(view.game, view.answers);
  if (view.state === 'open' && view.slot) {
    fields.push({ name: 'Joga com vocês em', value: slotText(view.slot, view.blocks) });
  }
  const votes = `${String(tally.inFavor)} a favor, ${String(tally.against)} contra`;
  fields.push({
    name: 'Votos',
    value: view.state === 'open' ? `${votes}, ${String(tally.missing)} sem votar` : votes,
  });
  if (view.state === 'open') {
    fields.push({ name: 'Prazo', value: timestamp(request.expiresAt, 'R') });
  }

  const mentioned = view.mentionMembers ? [...view.memberIds] : [];
  return {
    content: mentioned.map(mention).join(' '),
    embeds: [
      infoEmbed(
        {
          title: 'Pedido para entrar',
          description: joinVoteDescription(view),
          fields,
          footer: SQUADS_FOOTER,
        },
        view.embedColor,
      ),
    ],
    components:
      view.state === 'open'
        ? buttons(
            new ButtonBuilder()
              .setCustomId(requestButtonId('for', request.id))
              .setLabel('A FAVOR')
              .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
              .setCustomId(requestButtonId('against', request.id))
              .setLabel('CONTRA')
              .setStyle(ButtonStyle.Secondary),
          )
        : [],
    allowedMentions: { users: mentioned },
  };
}

/** O passo do CONVIDAR do guia: escolher a pessoa num select, sem digitar nome. */
export function invitePickMessage(squad: Pick<Squad, 'id' | 'name'>): BaseMessageOptions {
  return {
    content: `Quem você quer chamar para o **${squad.name}**? A pessoa recebe o convite numa conversa privada e entra assim que aceitar.`,
    components: [
      new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId(inviteUserSelectId(squad.id))
          .setPlaceholder('Escolha a pessoa')
          .setMinValues(1)
          .setMaxValues(1),
      ),
    ],
  };
}

// ── jogatina ────────────────────────────────────────────────────────────────

/**
 * Em que pé a jogatina está. `started` vale depois do início e fica assim: a
 * mensagem diz "começou há X" com timestamp relativo, que o Discord atualiza
 * sozinho, e oferece REPETIR.
 */
export type SessionState = 'scheduled' | 'started' | 'cancelled';

export interface SessionView {
  session: Pick<
    SquadSession,
    | 'id'
    | 'startsAt'
    | 'endsAt'
    | 'goingIds'
    | 'notGoingIds'
    | 'createdBy'
    | 'cancelledBy'
    | 'remindedAt'
  >;
  squad: Pick<Squad, 'name'>;
  memberIds: readonly string[];
  /** Quantos jogam juntos numa partida, do jogo do squad; `null` = jogo não achado. */
  partySize: number | null;
  /** O voice reservado agora; `null` = ainda não reservou ou não conseguiu. */
  voiceChannelId: string | null;
  /** O voice reservado foi criado só para esta jogatina e vai ser apagado. */
  voiceTemporary: boolean;
  /**
   * CHAMAR GENTE ainda vale: antes do início, sem chamada feita, com vaga no
   * squad e lugar na party. O botão só aparece quando funciona.
   */
  canCall: boolean;
  /** Onde a chamada pública desta jogatina está no ar; `null` = nenhuma no ar. */
  callChannelId: string | null;
  state: SessionState;
  /** Antecedência da reserva, para dizer quando a sala sai. */
  reminderMinutesBefore: number;
  embedColor: number;
  /** Só o primeiro envio chama os membros; a edição dos votos não pinga ninguém. */
  mentionMembers: boolean;
}

/**
 * Como quem vai cabe nas partidas. A jogatina tem um voice só, então com mais
 * gente que a party o bot não separa ninguém: só diz quantas parties dá, e o
 * squad se divide. `null` com menos de dois indo, quando não há party a contar.
 */
export function partyText(going: number, partySize: number): string | null {
  if (going < 2) return null;
  if (going < partySize) return `${String(going)} de ${String(partySize)}, ainda cabe gente.`;
  if (going === partySize) return `Fechada, ${String(going)} de ${String(partySize)}.`;
  const parties = Math.ceil(going / partySize);
  return `Dá ${String(parties)} parties: ${String(going)} vão e cada partida leva até ${String(partySize)}. Dividam-se.`;
}

function roomText(view: SessionView): string {
  if (view.voiceChannelId && view.voiceTemporary) {
    return `<#${view.voiceChannelId}>, ${TEMPORARY_VOICE_NOTE}.`;
  }
  if (view.voiceChannelId) {
    return `<#${view.voiceChannelId}>, reservada para o squad até ${timestamp(view.session.endsAt, 't')}.`;
  }
  if (view.session.remindedAt) return NO_RESERVED_VOICE_NOTE;
  return view.reminderMinutesBefore > 0
    ? `Reservo uma sala ${String(view.reminderMinutesBefore)} minutos antes.`
    : 'Reservo uma sala na hora.';
}

function sessionDescription(view: SessionView): string {
  const { session, squad } = view;
  const when = `${timestamp(session.startsAt, 'F')} (${timestamp(session.startsAt, 'R')})`;
  switch (view.state) {
    case 'scheduled': {
      const by = session.createdBy ? ` Quem chamou: ${mention(session.createdBy)}.` : '';
      return `**${squad.name}** joga ${when}.${by} Vai?`;
    }
    case 'started':
      return `A jogatina do **${squad.name}** começou ${timestamp(session.startsAt, 'R')}. Querem de novo na mesma hora da semana que vem? Aperte **REPETIR**.`;
    case 'cancelled':
      return session.cancelledBy
        ? `A jogatina de ${timestamp(session.startsAt, 'F')} foi cancelada por ${mention(session.cancelledBy)}.`
        : `A jogatina de ${timestamp(session.startsAt, 'F')} foi cancelada.`;
  }
}

const SESSION_TITLE: Record<SessionState, string> = {
  scheduled: 'Jogatina marcada',
  started: 'Jogatina começou',
  cancelled: 'Jogatina cancelada',
};

/** A mensagem de uma jogatina no canal do squad, com a contagem viva dos votos. */
export function sessionMessage(view: SessionView): BaseMessageOptions {
  const { session } = view;
  const fields: APIEmbedField[] = [];
  if (view.state !== 'cancelled') {
    const answered = new Set([...session.goingIds, ...session.notGoingIds]);
    fields.push(
      { name: 'Sala', value: roomText(view) },
      { name: 'Vão', value: mentionList(session.goingIds), inline: true },
      { name: 'Não vão', value: mentionList(session.notGoingIds), inline: true },
    );
    if (view.state === 'scheduled') {
      fields.push({
        name: 'Sem resposta',
        value: mentionList(view.memberIds.filter((id) => !answered.has(id))),
        inline: true,
      });
    }
    const party =
      view.partySize === null ? null : partyText(session.goingIds.length, view.partySize);
    if (party) fields.push({ name: 'Party', value: party });
    if (view.state === 'scheduled' && view.callChannelId) {
      fields.push({
        name: 'Chamada',
        value: `Aberta em <#${view.callChannelId}>: quem quiser jogar pede para entrar, e vocês votam aqui.`,
      });
    }
  }

  const scheduled = [
    new ButtonBuilder()
      .setCustomId(sessionButtonId('going', session.id))
      .setLabel('VOU')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(sessionButtonId('notgoing', session.id))
      .setLabel('NÃO VOU')
      .setStyle(ButtonStyle.Secondary),
  ];
  if (view.canCall) {
    scheduled.push(
      new ButtonBuilder()
        .setCustomId(callButtonId(session.id))
        .setLabel('CHAMAR GENTE')
        .setStyle(ButtonStyle.Secondary),
    );
  }
  scheduled.push(
    new ButtonBuilder()
      .setCustomId(sessionButtonId('cancel', session.id))
      .setLabel('CANCELAR')
      .setStyle(ButtonStyle.Danger),
  );
  const components =
    view.state === 'scheduled'
      ? buttons(...scheduled)
      : view.state === 'started'
        ? buttons(
            new ButtonBuilder()
              .setCustomId(sessionButtonId('repeat', session.id))
              .setLabel('REPETIR')
              .setStyle(ButtonStyle.Primary),
          )
        : [];

  const mentioned = view.mentionMembers ? [...view.memberIds] : [];
  return {
    content: mentioned.map(mention).join(' '),
    embeds: [
      infoEmbed(
        {
          title: SESSION_TITLE[view.state],
          description: sessionDescription(view),
          ...(fields.length > 0 ? { fields } : {}),
          footer: SQUADS_FOOTER,
        },
        view.embedColor,
      ),
    ],
    components,
    allowedMentions: { users: mentioned },
  };
}

/**
 * O lembrete de uma jogatina marcada com antecedência: chama quem não disse
 * "não vou" e aponta a sala. É uma mensagem curta à parte, porque editar a
 * mensagem da jogatina não notifica ninguém.
 */
export function sessionReminderMessage(view: {
  userIds: readonly string[];
  startsAt: Date;
  voiceChannelId: string | null;
  voiceTemporary?: boolean;
}): BaseMessageOptions {
  const where = !view.voiceChannelId
    ? 'Não consegui reservar sala desta vez: usem qualquer voice livre.'
    : view.voiceTemporary
      ? `A sala é <#${view.voiceChannelId}>, ${TEMPORARY_VOICE_NOTE}.`
      : `A sala é <#${view.voiceChannelId}>.`;
  return {
    content: `${view.userIds.map(mention).join(' ')} a jogatina do squad começa ${timestamp(view.startsAt, 'R')}. ${where}`,
    allowedMentions: { users: [...view.userIds] },
  };
}

/**
 * Na hora da jogatina, para quem não está em voice nenhum (não dá para mover).
 * Quando quem vai passa da party, o aviso de dividir vai junto: a mensagem da
 * jogatina também diz, mas editá-la não notifica ninguém.
 */
export function sessionStartMessage(view: {
  userIds: readonly string[];
  voiceChannelId: string | null;
  goingCount: number;
  partySize: number | null;
}): BaseMessageOptions {
  const where = view.voiceChannelId
    ? `Entrem em <#${view.voiceChannelId}>.`
    : 'Escolham um voice livre.';
  const split =
    view.partySize !== null && view.goingCount > view.partySize
      ? ` ${partyText(view.goingCount, view.partySize) ?? ''}`
      : '';
  return {
    content: `${view.userIds.map(mention).join(' ')} a jogatina do squad começou! ${where}${split}`,
    allowedMentions: { users: [...view.userIds] },
  };
}

export interface PublicCallView {
  session: Pick<SquadSession, 'id' | 'startsAt'>;
  squad: Pick<Squad, 'name'>;
  game: Pick<SquadGame, 'name' | 'groupSize' | 'partySize'>;
  memberCount: number;
  /** `formatHistory` do squad. */
  history: string;
  embedColor: number;
}

/**
 * A chamada pública do CHAMAR GENTE, no canal de busca: a jogatina, o squad e
 * o histórico dele, com ENTRAR. Não traz contagem de quem vai, que mudaria a
 * cada voto sem a mensagem acompanhar, e não chama ninguém: quem lê o canal de
 * busca está ali para isso. Sai do ar quando a jogatina começa.
 */
export function publicCallMessage(view: PublicCallView): BaseMessageOptions {
  const { session, squad, game } = view;
  const when = `${timestamp(session.startsAt, 'F')} (${timestamp(session.startsAt, 'R')})`;
  return {
    embeds: [
      infoEmbed(
        {
          title: `Bora jogar ${game.name}?`,
          description: [
            `O squad **${squad.name}** joga ${when} e tem lugar na party (cada partida leva até ${String(game.partySize)}).`,
            'Quer jogar junto? Aperte **ENTRAR**: o squad vota e, com metade dele a favor, você entra no squad e já fica marcado na jogatina.',
          ].join('\n\n'),
          fields: [
            {
              name: 'Squad',
              value: `${String(view.memberCount)} de ${String(game.groupSize)} jogadores`,
            },
            { name: 'Histórico', value: view.history.slice(0, MAX_FIELD_VALUE) },
          ],
          footer: SQUADS_FOOTER,
        },
        view.embedColor,
      ),
    ],
    components: buttons(
      new ButtonBuilder()
        .setCustomId(enterButtonId(session.id))
        .setLabel('ENTRAR')
        .setStyle(ButtonStyle.Success),
    ),
    allowedMentions: { parse: [] },
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
          description: `Faz ${String(view.weeks)} semanas que o **${view.squad.name}** não marca jogatina nem aparece no voice. Se vocês ainda jogam, cliquem em **Ainda jogamos**. Sem resposta em 7 dias, o squad é arquivado.`,
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
        'Quer um grupo fixo para jogar? Monte seu perfil no botão do jogo: responda as perguntas e marque os horários em que você costuma jogar.',
        'Eu cruzo as agendas e chamo, numa conversa privada, quem joga nos mesmos horários que você. O primeiro que aceitar cria o squad, com canal próprio. Lá, quando quiserem jogar, é só apertar BORA: eu chamo o grupo e reservo uma sala.',
      ].join('\n\n'),
      fields: [
        {
          name: 'Comandos',
          value: [
            '`/squad perfil` edita o seu perfil',
            '`/squad status` pausa ou retoma a busca',
            '`/squad procurar` mostra squads com vaga que combinam com você',
            '`/bora hoje 21h` marca uma jogatina do seu squad',
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

/**
 * Resposta de quem salvou a grade: o que vale agora, o botão de pausar ou
 * retomar e, para quem ainda não tem squad, o de ver os squads com vaga.
 */
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
  const list = toggle ? [toggle] : [];
  if (profile.status !== 'in_squad') {
    list.push(
      new ButtonBuilder()
        .setCustomId(searchButtonId(game.id))
        .setLabel('VER SQUADS COM VAGA')
        .setStyle(ButtonStyle.Secondary),
    );
  }
  return { embeds: [embed], components: list.length > 0 ? buttons(...list) : [] };
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
  game: Pick<SquadGame, 'name' | 'groupSize'>;
  entries: readonly {
    squad: Pick<Squad, 'id' | 'name'>;
    memberCount: number;
    /** `formatHistory` do squad. */
    history: string;
  }[];
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
            description: `Nenhum squad de **${view.game.name}** com vaga combina com você agora. Se você está procurando, eu mando seu perfil para um squad assim que abrir uma vaga que combine.`,
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
            'Estes squads têm vaga e jogam em horários parecidos com os seus. O pedido vai para o canal do squad, e eles votam: com metade a favor, você entra.',
          fields: entries.map((entry, index) => ({
            name: `${String(index + 1)}. ${entry.squad.name}`,
            value: `${String(entry.memberCount)} de ${String(view.game.groupSize)} jogadores. ${entry.history}`.slice(
              0,
              MAX_FIELD_VALUE,
            ),
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

export function inviteAnswerText(
  result:
    | { outcome: 'joined'; squad: Pick<Squad, 'name' | 'textChannelId'> }
    | { outcome: 'voting' | 'passed' }
    | { outcome: 'already'; status: SquadRequestStatus },
): string {
  switch (result.outcome) {
    case 'joined': {
      const where = channelOf(result.squad);
      const name = `**${result.squad.name}**`;
      return where ? `Você entrou no ${name}: ${where}.` : `Você entrou no ${name}.`;
    }
    case 'voting':
      return 'Pedido enviado ao squad. Eu aviso aqui quando decidirem.';
    case 'passed':
      return 'Anotado: você passou neste convite.';
    case 'already':
      switch (result.status) {
        case 'accepted':
          return 'Você já entrou neste squad.';
        case 'pending':
          return 'Seu pedido já está com o squad. Eu aviso aqui quando decidirem.';
        case 'expired':
          return 'Este convite expirou.';
        default:
          return 'Este convite já foi encerrado.';
      }
  }
}

export function joinVoteText(
  result:
    | { outcome: 'recorded'; inFavor: boolean }
    | { outcome: 'unchanged' | 'accepted' | 'declined' | 'closed' }
    | { outcome: 'already'; status: SquadRequestStatus },
): string {
  switch (result.outcome) {
    case 'recorded':
      return result.inFavor ? 'Voto registrado: a favor.' : 'Voto registrado: contra.';
    case 'unchanged':
      return 'Você já tinha votado assim.';
    case 'accepted':
      return 'Voto registrado. Deu metade do squad a favor: a pessoa já entrou.';
    case 'declined':
      return 'Voto registrado. O squad recusou a entrada.';
    case 'closed':
      return 'Voto registrado, mas a vaga não está mais disponível: a votação foi encerrada.';
    case 'already':
      if (result.status === 'accepted') return 'Esta votação já acabou: a pessoa entrou.';
      if (result.status === 'declined') return 'Esta votação já acabou: o squad recusou.';
      return 'Esta votação já foi encerrada.';
  }
}

export function voteText(going: boolean): string {
  return going ? 'Presença confirmada. Bom jogo!' : 'Anotado: você não vai desta vez.';
}

export function sessionScheduledText(result: {
  outcome: 'created' | 'exists';
  session: Pick<SquadSession, 'startsAt'>;
  squad: Pick<Squad, 'textChannelId'>;
}): string {
  const when = `${timestamp(result.session.startsAt, 'F')} (${timestamp(result.session.startsAt, 'R')})`;
  const where = channelOf(result.squad);
  if (result.outcome === 'exists') {
    return `O squad já tinha jogatina marcada para ${when}. Marquei você como VOU.`;
  }
  return where
    ? `Jogatina marcada para ${when}. Chamei o squad em ${where}.`
    : `Jogatina marcada para ${when}.`;
}

export function callSentText(result: {
  session: Pick<SquadSession, 'startsAt'>;
  channelId: string;
}): string {
  return `Chamei gente em <#${result.channelId}> para a jogatina de ${timestamp(result.session.startsAt, 'f')}. Quem pedir para entrar aparece aqui para vocês votarem.`;
}

export function callRequestSentText(result: {
  squad: Pick<Squad, 'name'>;
  session: Pick<SquadSession, 'startsAt'>;
}): string {
  return `Pedido enviado ao **${result.squad.name}**. O squad vota: com metade dele a favor, você entra e já fica marcado na jogatina de ${timestamp(result.session.startsAt, 'f')}.`;
}

export function sessionCancelledText(outcome: 'cancelled' | 'already'): string {
  return outcome === 'cancelled'
    ? 'Jogatina cancelada. Avisei no canal do squad.'
    : 'Esta jogatina já estava cancelada.';
}

export function renamedText(result: { squad: Pick<Squad, 'name'>; note: string | null }): string {
  const done = `Squad renomeado para **${result.squad.name}**.`;
  return result.note ? `${done} ${result.note}` : done;
}

export const KEEP_ALIVE_TEXT = 'Anotado! O squad continua ativo.';

export function joinRequestSentText(squad: Pick<Squad, 'name'>): string {
  return `Pedido enviado ao **${squad.name}**. O squad vota: com metade dele a favor, você entra e é chamado no canal do squad.`;
}

export function inviteSentText(userId: string, squad: Pick<Squad, 'name'>): string {
  return `Convite enviado para ${mention(userId)}. A pessoa recebe o convite numa conversa privada no canal de busca e entra no **${squad.name}** assim que aceitar.`;
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
