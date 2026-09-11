import {
  formatDuration,
  DEMO_DURATION_MS,
  DEMO_WARNING_BEFORE_MS,
  PENDING_EXPIRY_MS,
} from '@goodbot/shared';
import { time, TimestampStyles } from 'discord.js';

import { infoEmbed, successEmbed, warningEmbed } from './embeds';
import { childLogger } from '../logger';

import type { InviteNoticeKind } from '@goodbot/shared';
import type { Client, EmbedBuilder } from 'discord.js';

const log = childLogger('inviter-dm');

/**
 * O que o bot fala no privado de quem o convidou.
 *
 * Todo o texto dos avisos de ciclo de vida mora aqui — entrada, prazo, saída,
 * aprovação e recusa —, porque essas mensagens são a única coisa que alguém
 * que instalou o bot recebe antes de ele começar (ou deixar) de funcionar. Se
 * a cópia estivesse espalhada entre o job, a rota e o painel, cada caminho
 * contaria a história com meia palavra diferente.
 *
 * Regra que vale para todos: dizer **o que está acontecendo**, **até quando**
 * e **o que fazer a seguir**. Nenhum aviso termina sem uma saída.
 */
export interface InviterNotice {
  kind: InviteNoticeKind;
  /** Nome do servidor. `null` quando o bot já saiu e não tem mais no cache. */
  guildName?: string | null;
  /** Fim da demo, para os avisos que falam de prazo. */
  expiresAt?: Date | null;
  /** A nota escrita pelo dono do bot, nas recusas. */
  reason?: string | null;
  urls?: { invite?: string | null; panel?: string | null };
}

function servidor(notice: InviterNotice): string {
  return notice.guildName ? `**${notice.guildName}**` : 'seu servidor';
}

/** "Peça a aprovação: <link>" — ou a versão sem link, em dev sem `AUTH_URL`. */
function chamadaDoConvite(notice: InviterNotice): string {
  const url = notice.urls?.invite;
  return url
    ? `Para ter o Goodbot de vez, peça a aprovação por aqui: ${url}`
    : 'Para ter o Goodbot de vez, use o link do convite normal e peça a aprovação.';
}

function chamadaDoPainel(notice: InviterNotice): string {
  const url = notice.urls?.panel;
  return url
    ? `Abra o painel para configurar os módulos: ${url}`
    : 'Abra o painel do Goodbot para configurar os módulos.';
}

export function inviterNoticeEmbed(notice: InviterNotice): EmbedBuilder {
  const onde = servidor(notice);
  const expira = notice.expiresAt;

  switch (notice.kind) {
    case 'demo-started':
      return successEmbed({
        title: 'A demonstração começou',
        description: [
          `O Goodbot entrou em ${onde} **já funcionando**: comandos, moderação, automod, logs e` +
            ' painel, tudo ligado.',
          expira
            ? `Ela dura ${formatDuration(DEMO_DURATION_MS, { style: 'long' })} e acaba ` +
              `${time(expira, TimestampStyles.RelativeTime)}, às ` +
              `${time(expira, TimestampStyles.ShortTime)}. Aviso você aqui de novo ` +
              `${formatDuration(DEMO_WARNING_BEFORE_MS, { style: 'long' })} antes do fim.`
            : `A demonstração dura ${formatDuration(DEMO_DURATION_MS, { style: 'long' })}.`,
          'Quando o prazo acabar o bot sai sozinho, e **nada é apagado**: casos, tags, tickets e' +
            ' configuração ficam guardados e voltam como estavam se ele for aprovado depois.',
          '⚠️ A demonstração vale **uma vez por servidor** e não se renova.',
          chamadaDoConvite(notice),
        ].join('\n\n'),
      });

    case 'demo-ending':
      return warningEmbed({
        title: 'A demonstração está acabando',
        description: [
          expira
            ? `A demonstração do Goodbot em ${onde} acaba ` +
              `${time(expira, TimestampStyles.RelativeTime)}, às ${time(expira, TimestampStyles.ShortTime)}.`
            : `A demonstração do Goodbot em ${onde} está acabando.`,
          'Quando o prazo acabar ele sai sozinho. **A configuração fica guardada**: se ele voltar' +
            ' aprovado, tudo volta como estava.',
          chamadaDoConvite(notice),
        ].join('\n\n'),
      });

    case 'demo-ended':
      return infoEmbed({
        title: 'Fim da demonstração',
        description: [
          `O prazo da demonstração acabou e o Goodbot saiu de ${onde}.`,
          '**Nada foi apagado**: casos, tags, tickets e configuração continuam guardados e voltam' +
            ' como estavam se o bot for aprovado.',
          chamadaDoConvite(notice),
        ].join('\n\n'),
      });

    case 'queued':
      return infoEmbed({
        title: 'Convite recebido: aguardando aprovação',
        description: [
          `O Goodbot entrou em ${onde}, mas ainda **não está funcionando**: ele fica calado até o` +
            ' dono do bot aprovar o servidor. Não responde a comandos, não modera e não registra' +
            ' nada nesse meio-tempo.',
          'Isso é normal, e não é erro de configuração: o Goodbot é aprovado servidor a servidor.',
          `Pode deixar o bot lá, nada se perde. Se ninguém decidir em ` +
            `${formatDuration(PENDING_EXPIRY_MS, { style: 'long' })}, o convite é recusado` +
            ' sozinho, ele sai e avisa você aqui. Convidar de novo continua valendo.',
          'Aviso neste mesmo privado assim que o servidor for aprovado.',
        ].join('\n\n'),
      });

    case 'approved':
      return successEmbed({
        title: 'Servidor aprovado',
        description: [
          `O Goodbot foi aprovado em ${onde} e **já está atendendo**: comandos registrados,` +
            ' moderação e automod no ar.',
          'A aprovação não tem prazo.',
          chamadaDoPainel(notice),
        ].join('\n\n'),
      });

    case 'blocked':
      return warningEmbed({
        title: 'Servidor recusado',
        description: [
          `O Goodbot não vai atender ${onde}.`,
          notice.reason?.trim()
            ? `Motivo: ${notice.reason.trim()}`
            : 'O dono do bot não registrou um motivo.',
          'Se acha que é engano, fale com quem administra o bot. Convidar de novo não desfaz' +
            ' esta decisão.',
        ].join('\n\n'),
      });

    case 'expired':
      return warningEmbed({
        title: 'Convite recusado por inatividade',
        description: [
          `O convite do Goodbot para ${onde} ficou ` +
            `${formatDuration(PENDING_EXPIRY_MS, { style: 'long' })} na fila sem ser aprovado,` +
            ' então ele foi recusado e o bot saiu do servidor.',
          '**Isto não é um bloqueio** e nada foi apagado: você pode convidar de novo quando' +
            ' quiser, e a fila recomeça do zero.',
          chamadaDoConvite(notice),
        ].join('\n\n'),
      });
  }
}

/**
 * Manda o aviso no privado de quem convidou.
 *
 * Nunca lança e nunca é caminho crítico: DM fechada, bloqueio e "nenhum
 * servidor em comum" são situações normais (e a última é garantida no aviso de
 * recusa, em que o bot acabou de sair). O `boolean` existe para o chamador
 * registrar que não deu, não para tentar de novo — repetir DM recusada é como
 * se vira alvo de rate limit do Discord.
 */
export async function sendInviterDm(
  client: Client,
  userId: string | null | undefined,
  notice: InviterNotice,
): Promise<boolean> {
  if (!userId) return false;
  try {
    const user = await client.users.fetch(userId);
    if (user.bot) return false;
    await user.send({ embeds: [inviterNoticeEmbed(notice)] });
    log.info({ userId, kind: notice.kind }, 'aviso enviado a quem convidou');
    return true;
  } catch (error) {
    log.debug({ err: error, userId, kind: notice.kind }, 'não foi possível avisar quem convidou');
    return false;
  }
}
