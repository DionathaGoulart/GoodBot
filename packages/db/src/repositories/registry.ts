import { and, eq, gt, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';

import { guildRegistry } from '../schema/guilds';

import type { DbExecutor } from '../client';
import type { GuildStatus } from '@goodbot/shared';

export type GuildRegistryEntry = typeof guildRegistry.$inferSelect;

/**
 * O bot atende esta guild? `approved` não tem prazo; `demo` vale até
 * `expiresAt`. A conta é feita aqui (e não só no job de expiração) porque o
 * job pode estar atrasado — e um minuto de atraso não pode virar um minuto de
 * bot atendendo de graça quem já venceu.
 */
export function isGuildServed(
  entry: GuildRegistryEntry | undefined,
  now: Date = new Date(),
): boolean {
  if (!entry) return false;
  if (entry.status === 'approved') return true;
  return entry.status === 'demo' && entry.expiresAt !== null && entry.expiresAt > now;
}

export async function listGuildRegistry(
  db: DbExecutor,
  options: { status?: readonly GuildStatus[] } = {},
): Promise<GuildRegistryEntry[]> {
  const query = db.select().from(guildRegistry);
  if (options.status && options.status.length > 0) {
    return query.where(inArray(guildRegistry.status, [...options.status]));
  }
  return query;
}

export async function getGuildRegistryEntry(
  db: DbExecutor,
  guildId: string,
): Promise<GuildRegistryEntry | null> {
  const [row] = await db
    .select()
    .from(guildRegistry)
    .where(eq(guildRegistry.guildId, guildId))
    .limit(1);
  return row ?? null;
}

/** Os IDs que o bot atende agora — a lista que substituiu o `GUILD_IDS`. */
export async function listServedGuildIds(
  db: DbExecutor,
  now: Date = new Date(),
): Promise<string[]> {
  const rows = await db
    .select({ guildId: guildRegistry.guildId })
    .from(guildRegistry)
    .where(
      or(
        eq(guildRegistry.status, 'approved'),
        and(
          eq(guildRegistry.status, 'demo'),
          isNotNull(guildRegistry.expiresAt),
          // `gt` e não um `sql` cru: o template não conhece a coluna, então o
          // `Date` chega ao postgres-js como objeto. Em Node puro ele infere
          // timestamptz e serializa; no bundle do painel (Vercel/Turbopack) a
          // inferência falha e o driver tenta escrever o `Date` no protocolo:
          // `ERR_INVALID_ARG_TYPE`, 500 em toda tela logada. Pelo operador do
          // Drizzle o valor passa pelo `mapToDriverValue` da coluna e viaja
          // como texto ISO, que é o que o resto do repositório já faz.
          gt(guildRegistry.expiresAt, now),
        ),
      ),
    );
  return rows.map((row) => row.guildId);
}

/**
 * Semeia como `approved` os IDs que estavam no `GUILD_IDS`. Roda a cada boot e
 * é idempotente de propósito: `do nothing` garante que um servidor bloqueado
 * depois não volte a ser aprovado só porque o ID continua na variável.
 */
export async function seedApprovedGuilds(
  db: DbExecutor,
  guildIds: readonly string[],
): Promise<number> {
  if (guildIds.length === 0) return 0;
  const rows = await db
    .insert(guildRegistry)
    .values(
      guildIds.map((guildId) => ({
        guildId,
        status: 'approved' as const,
        approvedAt: new Date(),
        note: 'semeado a partir do GUILD_IDS',
      })),
    )
    .onConflictDoNothing({ target: guildRegistry.guildId })
    .returning({ guildId: guildRegistry.guildId });
  return rows.length;
}

/**
 * Registra a entrada do bot numa guild. Sem linha, ela nasce `pending` — quem
 * chega por fora do fluxo de convite espera aprovação como qualquer um. Com
 * linha, só o `leftAt` é limpo: o status já decidido continua valendo.
 */
export async function ensureGuildRegistered(
  db: DbExecutor,
  input: {
    guildId: string;
    status?: GuildStatus;
    invitedBy?: string | null;
    expiresAt?: Date | null;
  },
): Promise<GuildRegistryEntry> {
  const [row] = await db
    .insert(guildRegistry)
    .values({
      guildId: input.guildId,
      status: input.status ?? 'pending',
      invitedBy: input.invitedBy ?? null,
      expiresAt: input.expiresAt ?? null,
      approvedAt: (input.status ?? 'pending') === 'approved' ? new Date() : null,
    })
    .onConflictDoUpdate({
      target: guildRegistry.guildId,
      set: { leftAt: null, updatedAt: sql`now()` },
    })
    .returning();
  // O `returning` de um upsert sempre devolve a linha.
  return row as GuildRegistryEntry;
}

export interface SetGuildStatusInput {
  status: GuildStatus;
  expiresAt?: Date | null;
  invitedBy?: string | null;
  note?: string | null;
}

/** Muda o status de um registro que já existe (aprovar, bloquear, expirar). */
export async function setGuildStatus(
  db: DbExecutor,
  guildId: string,
  input: SetGuildStatusInput,
): Promise<GuildRegistryEntry | null> {
  const [row] = await db
    .update(guildRegistry)
    .set({
      status: input.status,
      ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
      ...(input.invitedBy === undefined ? {} : { invitedBy: input.invitedBy }),
      ...(input.note === undefined ? {} : { note: input.note }),
      ...(input.status === 'approved' ? { approvedAt: new Date() } : {}),
      updatedAt: sql`now()`,
    })
    .where(eq(guildRegistry.guildId, guildId))
    .returning();
  return row ?? null;
}

/** O bot saiu (ou foi removido). O status fica: voltar não pede aprovação nova. */
export async function markGuildLeft(db: DbExecutor, guildId: string): Promise<void> {
  await db
    .update(guildRegistry)
    .set({ leftAt: sql`now()`, updatedAt: sql`now()` })
    .where(eq(guildRegistry.guildId, guildId));
}

/**
 * Demos vencidas que o job de expiração ainda não tratou (plano, Etapa 3).
 *
 * O `demo_ended_at` é o que fecha a varredura: o `status` continua `demo` para
 * sempre (é ele que diz "este servidor já usou a sua demo" na tela do convite
 * e na fila do painel admin), então sem esta coluna a mesma linha voltaria em
 * toda passada, para todo o sempre.
 */
export async function listExpiredDemoGuilds(
  db: DbExecutor,
  now: Date = new Date(),
): Promise<GuildRegistryEntry[]> {
  return db
    .select()
    .from(guildRegistry)
    .where(
      and(
        eq(guildRegistry.status, 'demo'),
        isNotNull(guildRegistry.expiresAt),
        lte(guildRegistry.expiresAt, now),
        isNull(guildRegistry.demoEndedAt),
      ),
    );
}

/**
 * Demos que vencem dentro de `withinMs` e ainda não receberam o aviso. Quem já
 * venceu fica de fora: para essa a passada seguinte manda a despedida, e um
 * "faltam 10 minutos" depois da hora seria mentira.
 */
export async function listDemoGuildsToWarn(
  db: DbExecutor,
  withinMs: number,
  now: Date = new Date(),
): Promise<GuildRegistryEntry[]> {
  return db
    .select()
    .from(guildRegistry)
    .where(
      and(
        eq(guildRegistry.status, 'demo'),
        isNotNull(guildRegistry.expiresAt),
        gt(guildRegistry.expiresAt, now),
        lte(guildRegistry.expiresAt, new Date(now.getTime() + withinMs)),
        isNull(guildRegistry.demoWarnedAt),
        isNull(guildRegistry.demoEndedAt),
      ),
    );
}

/** O aviso de fim de demo saiu. Marcado antes do envio (ver o job). */
export async function markDemoWarned(
  db: DbExecutor,
  guildId: string,
  at: Date = new Date(),
): Promise<void> {
  await db
    .update(guildRegistry)
    .set({ demoWarnedAt: at, updatedAt: sql`now()` })
    .where(eq(guildRegistry.guildId, guildId));
}

/** A demo foi encerrada pelo job: despedida enviada e saída feita. */
export async function markDemoEnded(
  db: DbExecutor,
  guildId: string,
  at: Date = new Date(),
): Promise<void> {
  await db
    .update(guildRegistry)
    .set({ demoEndedAt: at, updatedAt: sql`now()` })
    .where(eq(guildRegistry.guildId, guildId));
}
