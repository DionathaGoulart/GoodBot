import 'server-only';

import {
  claimInvitedGuild,
  getGuildRegistryEntry,
  isGuildServed,
  type GuildRegistryEntry,
} from '@goodbot/db';
import { DEMO_DURATION_MS, INVITE_FLOW_STATUS, type InviteFlow } from '@goodbot/shared';

import { db } from '@/lib/db';
import { internalApi } from '@/lib/internal-api';

/**
 * Grava a entrada do bot num servidor, com o status do fluxo que a pessoa usou.
 *
 * Quem decide é o `claimInvitedGuild`, e a razão de ele existir é uma corrida
 * inevitável: o Discord adiciona o bot no clique em "Autorizar", então o
 * `guildCreate` grava a linha como `pending` **antes** de este callback rodar.
 * Um upsert que nunca sobrescreve — como era aqui — deixava o link da
 * demonstração entregar um servidor `pending`: demo nenhuma, nunca.
 *
 * O convite assume a linha só quando ela é `pending` (a que o `guildCreate`
 * acabou de criar) ou `expired` (venceu na fila e estão convidando de novo).
 * Daí saem as regras de sempre:
 *
 * · servidor bloqueado continua bloqueado por mais que alguém use o link;
 * · servidor já aprovado não volta para a fila nem vira demo com prazo;
 * · a demo não se renova — quem já teve a sua entra na fila mesmo clicando no
 *   link da demo, porque a memória disso é o `demoEndedAt`, não o status.
 */
export async function registerInvitedGuild(input: {
  guildId: string;
  flow: InviteFlow;
  invitedBy: string | null;
  now?: Date;
}): Promise<GuildRegistryEntry> {
  const now = input.now ?? new Date();
  const status = INVITE_FLOW_STATUS[input.flow];

  return claimInvitedGuild(db(), {
    guildId: input.guildId,
    status,
    invitedBy: input.invitedBy,
    expiresAt: status === 'demo' ? new Date(now.getTime() + DEMO_DURATION_MS) : null,
  });
}

/** O que dizer à pessoa na tela de destino. */
export type InviteOutcome =
  | { kind: 'demo'; expiresAt: Date }
  | { kind: 'pending' }
  | { kind: 'approved' }
  | { kind: 'blocked' }
  /** Já usou a demo e o prazo venceu: agora depende de aprovação. */
  | { kind: 'demo-vencida' }
  /** Ficou na fila além do prazo e foi recusado; convidar de novo vale. */
  | { kind: 'expirado' }
  /** Sem linha no registro — só acontece se algo deu errado no meio. */
  | { kind: 'desconhecido' };

export function inviteOutcome(
  entry: GuildRegistryEntry | null,
  now: Date = new Date(),
): InviteOutcome {
  if (!entry) return { kind: 'desconhecido' };

  switch (entry.status) {
    case 'approved':
      return { kind: 'approved' };
    case 'blocked':
      return { kind: 'blocked' };
    case 'expired':
      return { kind: 'expirado' };
    case 'demo':
      return isGuildServed(entry, now) && entry.expiresAt
        ? { kind: 'demo', expiresAt: entry.expiresAt }
        : { kind: 'demo-vencida' };
    case 'pending':
      // Quem já gastou a demo e voltou para a fila merece a explicação do
      // porquê: clicou no link da demonstração e caiu na fila mesmo assim.
      return entry.demoEndedAt ? { kind: 'demo-vencida' } : { kind: 'pending' };
  }
}

/** O estado atual de um servidor, para a tela de destino do convite. */
export async function guildOutcome(guildId: string): Promise<InviteOutcome> {
  return inviteOutcome(await getGuildRegistryEntry(db(), guildId));
}

/**
 * Pede ao bot o aviso por DM de quem acabou de convidar.
 *
 * Mora do lado do painel porque **só aqui o fluxo é conhecido**: quando o
 * `guildCreate` chega ao bot, a linha ainda é `pending` mesmo para quem usou o
 * link da demonstração. A chamada é melhor-esforço — o bot fora do ar não pode
 * transformar uma instalação que deu certo numa tela de erro —, e servidor já
 * aprovado ou bloqueado não recebe nada: o convite não mudou nada para ele.
 */
export async function notifyInviter(entry: GuildRegistryEntry): Promise<void> {
  if (!entry.invitedBy) return;

  const kind = isGuildServed(entry) && entry.status === 'demo' ? 'demo-started' : null;
  const escolhido = kind ?? (entry.status === 'pending' ? 'queued' : null);
  if (!escolhido) return;

  // Engolido de propósito: o painel não tem log estruturado, e o aviso é o
  // último passo de um convite que já deu certo. Quem precisa saber que ele
  // não saiu é o log do bot, que registra cada tentativa.
  try {
    await internalApi().inviteNotice(entry.guildId, { kind: escolhido });
  } catch {
    return;
  }
}
