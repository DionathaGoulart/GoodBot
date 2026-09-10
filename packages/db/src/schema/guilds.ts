import { sql } from 'drizzle-orm';
import { index, pgTable } from 'drizzle-orm/pg-core';

import { createdAt, snowflake, text, timestamptz, updatedAt } from './_columns';
import { guildStatusEnum } from './enums';

/** Servidores em que o bot está (ou esteve). */
export const guilds = pgTable('guilds', {
  id: snowflake('id').primaryKey(),
  name: text('name').notNull(),
  icon: text('icon'),
  ownerId: snowflake('owner_id').notNull(),
  joinedAt: timestamptz('joined_at').notNull().defaultNow(),
  leftAt: timestamptz('left_at'),
  createdAt: createdAt(),
});

/**
 * Quem o bot atende, e por quê. Esta tabela — não o `GUILD_IDS` — é a
 * fronteira de segurança: o bot só responde onde há uma linha atendível aqui.
 *
 * Não há FK para `guilds`: a linha nasce no callback do convite, antes de o
 * gateway mandar o `GUILD_CREATE` que cria a guild. A ordem inversa também
 * acontece (o bot é adicionado por fora do nosso fluxo), e nos dois casos o
 * registro precisa aguentar existir sozinho.
 */
export const guildRegistry = pgTable(
  'guild_registry',
  {
    guildId: snowflake('guild_id').primaryKey(),
    status: guildStatusEnum('status').notNull().default('pending'),
    /** Quem clicou no convite. Nulo nas linhas semeadas pelo `GUILD_IDS`. */
    invitedBy: snowflake('invited_by'),
    invitedAt: timestamptz('invited_at').notNull().defaultNow(),
    approvedAt: timestamptz('approved_at'),
    /** Só a demo tem prazo; nas outras é nulo. */
    expiresAt: timestamptz('expires_at'),
    /**
     * Quando o bot avisou no servidor que a demo estava para acabar. Fica no
     * banco (e não numa memória do processo) porque um deploy no meio da hora
     * faria o aviso sair de novo a cada passada do job.
     */
    demoWarnedAt: timestamptz('demo_warned_at'),
    /**
     * Quando o job de expiração já se despediu e saiu. É o que impede a demo
     * vencida de voltar na varredura para sempre: o `status` continua `demo`,
     * porque é ele que conta a história ("já usou a sua") na tela do convite.
     */
    demoEndedAt: timestamptz('demo_ended_at'),
    /** Quando o bot saiu (ou foi removido). Voltar limpa o campo. */
    leftAt: timestamptz('left_at'),
    /** Motivo do bloqueio ou da recusa, para a fila do painel admin. */
    note: text('note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('guild_registry_status_idx').on(t.status),
    index('guild_registry_expires_idx')
      .on(t.expiresAt)
      .where(sql`${t.expiresAt} is not null`),
  ],
);
