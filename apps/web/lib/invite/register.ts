import 'server-only';

import {
  ensureGuildRegistered,
  getGuildRegistryEntry,
  isGuildServed,
  type GuildRegistryEntry,
} from '@goodbot/db';
import { DEMO_DURATION_MS, INVITE_FLOW_STATUS, type InviteFlow } from '@goodbot/shared';

import { db } from '@/lib/db';

/**
 * Grava a entrada do bot num servidor, com o status do fluxo que a pessoa usou.
 *
 * O `ensureGuildRegistered` **não** sobrescreve o status de uma linha que já
 * existe, e é isso que decide três regras de uma vez:
 *
 * · servidor bloqueado continua bloqueado por mais que alguém use o link;
 * · servidor já aprovado não volta para a fila nem vira demo com prazo;
 * · a demo não se renova — quem já teve a sua sai do prazo e espera aprovação
 *   como qualquer um, senão dava para ficar renovando de hora em hora.
 */
export async function registerInvitedGuild(input: {
  guildId: string;
  flow: InviteFlow;
  invitedBy: string | null;
  now?: Date;
}): Promise<GuildRegistryEntry> {
  const now = input.now ?? new Date();
  const status = INVITE_FLOW_STATUS[input.flow];

  return ensureGuildRegistered(db(), {
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
    case 'demo':
      return isGuildServed(entry, now) && entry.expiresAt
        ? { kind: 'demo', expiresAt: entry.expiresAt }
        : { kind: 'demo-vencida' };
    case 'pending':
      return { kind: 'pending' };
  }
}

/** O estado atual de um servidor, para a tela de destino do convite. */
export async function guildOutcome(guildId: string): Promise<InviteOutcome> {
  return inviteOutcome(await getGuildRegistryEntry(db(), guildId));
}
