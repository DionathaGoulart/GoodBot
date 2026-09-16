/**
 * A votação de quem quer entrar num squad que já existe (a fase 2 da entrada).
 * Puro: o bot decide com a lista de membros lida na hora, e os testes cobrem a
 * regra sem banco nem Discord.
 *
 * A regra favorece a entrada: empate entra. Um squad existe para jogar, e uma
 * vaga parada custa mais que um membro a mais que metade do grupo topou.
 */

export type JoinVoteOutcome = 'accepted' | 'declined' | 'expired' | 'open';

export interface JoinVoteInput {
  /** Os membros de agora. Voto de quem saiu do squad não conta. */
  memberIds: readonly string[];
  forIds: readonly string[];
  againstIds: readonly string[];
  /** O prazo venceu: decide com os votos que existem. */
  expired: boolean;
}

export interface JoinVoteTally {
  members: number;
  inFavor: number;
  against: number;
  /** Membros que ainda não votaram. */
  missing: number;
}

/**
 * A contagem só com os membros atuais. Quem aparece nas duas listas conta a
 * favor: o banco nunca grava assim, e na dúvida a regra favorece a entrada.
 */
export function tallyJoinVote(input: Omit<JoinVoteInput, 'expired'>): JoinVoteTally {
  const members = new Set(input.memberIds);
  const inFavor = new Set(input.forIds.filter((id) => members.has(id)));
  const against = new Set(input.againstIds.filter((id) => members.has(id) && !inFavor.has(id)));
  return {
    members: members.size,
    inFavor: inFavor.size,
    against: against.size,
    missing: members.size - inFavor.size - against.size,
  };
}

/**
 * - metade ou mais a favor (`ceil(membros / 2)`): entra na hora, porque nem
 *   todo o resto contra passaria do empate;
 * - mais da metade contra: recusado na hora. Com todos votando, uma das duas
 *   sempre vale, então "todos votaram, entra com `a favor >= contra`" já está
 *   aqui;
 * - prazo vencido: entra com pelo menos um a favor e `a favor >= contra`; sem
 *   isso, `expired` (ninguém decidiu, o que é diferente de recusar);
 * - squad sem membros não aceita ninguém.
 */
export function decideJoinVote(input: JoinVoteInput): JoinVoteOutcome {
  const tally = tallyJoinVote(input);
  if (tally.members === 0) return input.expired ? 'expired' : 'open';
  if (tally.inFavor >= Math.ceil(tally.members / 2)) return 'accepted';
  if (tally.against > tally.members / 2) return 'declined';
  if (!input.expired) return 'open';
  return tally.inFavor >= 1 && tally.inFavor >= tally.against ? 'accepted' : 'expired';
}
