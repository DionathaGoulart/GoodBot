import { and, asc, eq, sql } from 'drizzle-orm';

import { tags } from '../schema/community';
import { guilds } from '../schema/guilds';

import type { DbExecutor } from '../client';
import type { Tag } from '../types';
import type { MessageTemplate } from '@cobot/shared';

/**
 * Nome canônico de uma tag: minúsculo e sem espaços nas pontas. O índice único
 * é `(guild_id, name)`, então `/tags create Regras` e `/tag regras` precisam
 * bater na mesma linha.
 */
export function normalizeTagName(name: string): string {
  return name.trim().toLowerCase();
}

export interface CreateTagInput {
  guildId: string;
  name: string;
  content: MessageTemplate;
  createdBy: string;
}

export async function listTags(db: DbExecutor, guildId: string): Promise<Tag[]> {
  return db.select().from(tags).where(eq(tags.guildId, guildId)).orderBy(asc(tags.name));
}

/** Só os nomes: alimenta o autocomplete sem trazer os jsonb de conteúdo. */
export async function listTagNames(db: DbExecutor, guildId: string): Promise<string[]> {
  const rows = await db
    .select({ name: tags.name })
    .from(tags)
    .where(eq(tags.guildId, guildId))
    .orderBy(asc(tags.name));
  return rows.map((row) => row.name);
}

export async function countTags(db: DbExecutor, guildId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tags)
    .where(eq(tags.guildId, guildId));
  return row?.count ?? 0;
}

export async function getTag(
  db: DbExecutor,
  guildId: string,
  name: string,
): Promise<Tag | null> {
  const [row] = await db
    .select()
    .from(tags)
    .where(and(eq(tags.guildId, guildId), eq(tags.name, normalizeTagName(name))))
    .limit(1);
  return row ?? null;
}

/** `null` quando já existe uma tag com esse nome na guild. */
export async function createTag(db: DbExecutor, input: CreateTagInput): Promise<Tag | null> {
  await db
    .insert(guilds)
    .values({ id: input.guildId, name: '', ownerId: '' })
    .onConflictDoNothing({ target: guilds.id });

  const [row] = await db
    .insert(tags)
    .values({ ...input, name: normalizeTagName(input.name) })
    .onConflictDoNothing({ target: [tags.guildId, tags.name] })
    .returning();
  return row ?? null;
}

export async function updateTag(
  db: DbExecutor,
  guildId: string,
  name: string,
  content: MessageTemplate,
): Promise<Tag | null> {
  const [row] = await db
    .update(tags)
    .set({ content, updatedAt: sql`now()` })
    .where(and(eq(tags.guildId, guildId), eq(tags.name, normalizeTagName(name))))
    .returning();
  return row ?? null;
}

export async function deleteTag(
  db: DbExecutor,
  guildId: string,
  name: string,
): Promise<Tag | null> {
  const [row] = await db
    .delete(tags)
    .where(and(eq(tags.guildId, guildId), eq(tags.name, normalizeTagName(name))))
    .returning();
  return row ?? null;
}

/**
 * Lê a tag e incrementa `uses` na mesma ida ao banco — o contador não pode
 * depender de o envio da mensagem dar certo depois.
 */
export async function useTag(
  db: DbExecutor,
  guildId: string,
  name: string,
): Promise<Tag | null> {
  const [row] = await db
    .update(tags)
    .set({ uses: sql`${tags.uses} + 1` })
    .where(and(eq(tags.guildId, guildId), eq(tags.name, normalizeTagName(name))))
    .returning();
  return row ?? null;
}
