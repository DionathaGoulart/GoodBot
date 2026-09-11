import { z } from 'zod';

import { MAX_REASON_LENGTH } from '../constants';

/**
 * O aviso por DM para quem convidou o bot.
 *
 * Ele existe como rota porque **o bot não sabe por qual link a pessoa veio**.
 * O Discord adiciona o bot no clique em "Autorizar", então o `guildCreate`
 * chega antes de o callback trocar o `code`: no momento em que o bot poderia
 * falar, a linha do registro ainda é `pending` mesmo quando o link era o da
 * demonstração. Quem sabe o fluxo é o painel, e é ele que pede o aviso certo.
 *
 * Fora de `/guilds` pelo mesmo motivo do `/admin`: metade dos avisos é sobre
 * servidor que o bot **não** atende (a fila), e o `withGuild` recusaria
 * justamente esses.
 *
 * Não há `actorId` aqui, e é deliberado: não existe ator. Quem convidou já foi
 * provado pela troca do `code` no OAuth, e o destinatário não é escolhido pela
 * chamada — é o `invited_by` da linha do registro. O corpo só escolhe **qual**
 * texto sai, de uma lista fechada; o texto em si mora no bot.
 */
export const INVITE_NOTICE_KINDS = [
  /** Demo começou: o bot entrou funcionando e tem prazo. */
  'demo-started',
  /** Faltam poucos minutos para a demo acabar. */
  'demo-ending',
  /** A demo acabou e o bot saiu. */
  'demo-ended',
  /** Convite normal: o bot entrou calado e espera aprovação. */
  'queued',
  /** O dono do bot aprovou o servidor. */
  'approved',
  /** O dono do bot recusou ou bloqueou o servidor. */
  'blocked',
  /** O convite venceu na fila sem decisão e o bot saiu. */
  'expired',
] as const;
export type InviteNoticeKind = (typeof INVITE_NOTICE_KINDS)[number];

export const InviteNoticeInputSchema = z.object({
  kind: z.enum(INVITE_NOTICE_KINDS),
  /** O motivo escrito pelo dono do bot, quando houver (recusa e bloqueio). */
  reason: z.string().max(MAX_REASON_LENGTH).optional(),
});
export type InviteNoticeInput = z.infer<typeof InviteNoticeInputSchema>;

export const InviteNoticeResultSchema = z.object({
  /** A DM chegou? `false` é resultado normal: DM fechada é comum. */
  delivered: z.boolean(),
  /** Quem recebeu (ou receberia). `null` quando o registro não sabe. */
  userId: z.string().nullable(),
});
export type InviteNoticeResult = z.infer<typeof InviteNoticeResultSchema>;
