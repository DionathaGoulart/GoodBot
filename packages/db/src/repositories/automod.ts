import { and, asc, eq, lt } from 'drizzle-orm';

import { automodHits, automodRules } from '../schema/automod';
import { guilds } from '../schema/guilds';

import type { DbExecutor } from '../client';
import type { AutomodHit, AutomodRuleRow, NewAutomodRuleRow } from '../types';

/**
 * Regras da guild na ordem de avaliação (menor `priority` primeiro). O bot
 * valida cada linha com `AutomodRuleSchema` antes de usar — o jsonb aqui é
 * `unknown` de propósito.
 */
export async function getAutomodRules(
  db: DbExecutor,
  guildId: string,
): Promise<AutomodRuleRow[]> {
  return db
    .select()
    .from(automodRules)
    .where(eq(automodRules.guildId, guildId))
    .orderBy(asc(automodRules.priority), asc(automodRules.name));
}

export async function getAutomodRule(
  db: DbExecutor,
  guildId: string,
  ruleId: string,
): Promise<AutomodRuleRow | null> {
  const [row] = await db
    .select()
    .from(automodRules)
    .where(and(eq(automodRules.guildId, guildId), eq(automodRules.id, ruleId)))
    .limit(1);
  return row ?? null;
}

export type CreateAutomodRuleInput = Omit<NewAutomodRuleRow, 'id' | 'createdAt' | 'updatedAt'>;

/** Usado pelo painel (Etapa 15) e pelos testes de integração. */
export async function createAutomodRule(
  db: DbExecutor,
  input: CreateAutomodRuleInput,
): Promise<AutomodRuleRow> {
  await db
    .insert(guilds)
    .values({ id: input.guildId, name: '', ownerId: '' })
    .onConflictDoNothing({ target: guilds.id });

  const [row] = await db.insert(automodRules).values(input).returning();
  if (!row) throw new Error('INSERT em automod_rules não retornou linha');
  return row;
}

/** `null` quando a regra não existe (ou é de outra guild). */
export async function setAutomodRuleEnabled(
  db: DbExecutor,
  guildId: string,
  ruleId: string,
  enabled: boolean,
): Promise<AutomodRuleRow | null> {
  const [row] = await db
    .update(automodRules)
    .set({ enabled, updatedAt: new Date() })
    .where(and(eq(automodRules.guildId, guildId), eq(automodRules.id, ruleId)))
    .returning();
  return row ?? null;
}

export async function deleteAutomodRule(
  db: DbExecutor,
  guildId: string,
  ruleId: string,
): Promise<boolean> {
  const rows = await db
    .delete(automodRules)
    .where(and(eq(automodRules.guildId, guildId), eq(automodRules.id, ruleId)))
    .returning({ id: automodRules.id });
  return rows.length > 0;
}

export type RecordAutomodHitInput = Omit<AutomodHit, 'id' | 'createdAt'>;

/** Um disparo de regra. Volume alto: sem `returning`. */
export async function recordAutomodHit(
  db: DbExecutor,
  input: RecordAutomodHitInput,
): Promise<void> {
  await db.insert(automodHits).values(input);
}

/** Job de retenção (PRD §8): 30 dias. */
export async function deleteAutomodHitsBefore(db: DbExecutor, before: Date): Promise<number> {
  const rows = await db
    .delete(automodHits)
    .where(lt(automodHits.createdAt, before))
    .returning({ id: automodHits.id });
  return rows.length;
}
