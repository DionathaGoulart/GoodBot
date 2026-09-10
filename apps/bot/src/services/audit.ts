import { appendAudit } from '@goodbot/db';

import { childLogger } from '../logger';

import type { Db } from '@goodbot/db';
import type { AuditSource } from '@goodbot/shared';
import type { Client } from 'discord.js';

const log = childLogger('audit');

/** Quem disparou a ação. Ausente = foi o bot, por conta de uma regra. */
export interface AuditActor {
  id: string;
  tag: string;
}

export interface AuditEntry {
  guildId: string;
  /** Família pontuada: `automod.hit`, `autorole.apply`, `ticket.open`. */
  action: string;
  source: AuditSource;
  /**
   * Quem pediu. Um id solto é resolvido no cache de usuários do client;
   * omitido, o ator é o próprio bot — foi uma regra que agiu, não alguém.
   */
  actor?: AuditActor | string | null;
  target?: { type?: string; id?: string | null };
  /** O porquê: motivo da punição, regra que casou, conta que publicou. */
  reason?: string | null;
  before?: unknown;
  after?: unknown;
}

export interface AuditDeps {
  db: Db;
  /** Resolve a tag do bot e a de quem só chegou como id. */
  client?: Pick<Client, 'user' | 'users'>;
}

/**
 * Escreve em `audit_logs` o que o **bot** faz (PRD §6.5, Etapa 22). O painel
 * tem o seu próprio `withAudit`, que grava `source: 'dashboard'` e ainda anexa
 * IP e user-agent; aqui não há request, então esses dois ficam nulos.
 *
 * Nada aqui lança nem espera: uma falha de auditoria não pode impedir a
 * punição que ela descreve. Use `record` no caminho quente e `write` só quando
 * o chamador realmente quiser esperar (testes).
 */
export class AuditService {
  private readonly db: Db;
  private readonly client: Pick<Client, 'user' | 'users'> | undefined;

  constructor(deps: AuditDeps) {
    this.db = deps.db;
    this.client = deps.client;
  }

  /** Fire-and-forget: registra em segundo plano e engole o erro no log. */
  record(entry: AuditEntry): void {
    void this.write(entry);
  }

  async write(entry: AuditEntry): Promise<void> {
    const actor = this.resolveActor(entry.actor);
    try {
      await appendAudit(this.db, {
        guildId: entry.guildId,
        actorId: actor.id,
        actorTag: actor.tag,
        action: entry.action,
        source: entry.source,
        reason: entry.reason ?? null,
        targetType: entry.target?.type ?? null,
        targetId: entry.target?.id ?? null,
        before: entry.before ?? null,
        after: entry.after ?? null,
        ip: null,
        userAgent: null,
      });
    } catch (error) {
      log.error(
        { err: error, guildId: entry.guildId, action: entry.action, source: entry.source },
        'falha ao gravar a auditoria',
      );
    }
  }

  /**
   * Sem ator, quem assina é o bot. `0` como id (snowflake impossível) é o
   * fallback para o instante entre o boot e o `ready`, em que `client.user`
   * ainda é `null`. Um id fora do cache vira a sua própria tag: melhor um
   * snowflake na coluna do que uma ida à API do Discord por uma linha de log.
   */
  private resolveActor(actor: AuditEntry['actor']): AuditActor {
    if (actor && typeof actor === 'object') return actor;
    if (typeof actor === 'string') {
      return { id: actor, tag: this.client?.users.cache.get(actor)?.tag ?? actor };
    }
    const user = this.client?.user;
    return { id: user?.id ?? '0', tag: user?.tag ?? 'Goodbot' };
  }
}
