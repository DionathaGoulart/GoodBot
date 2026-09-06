import { and, asc, eq, sql } from 'drizzle-orm';

import { reactionRoleItems, reactionRolePanels } from '../schema/community';
import { guilds } from '../schema/guilds';

import type { DbExecutor } from '../client';
import type { ReactionRoleItem, ReactionRolePanel } from '../types';
import type { MessageTemplate, ReactionRoleMode, ReactionRoleStyle } from '@cobot/shared';

/** Painel com os itens já carregados — é sempre assim que o bot o usa. */
export interface PanelWithItems extends ReactionRolePanel {
  items: ReactionRoleItem[];
}

export interface CreatePanelInput {
  guildId: string;
  channelId: string;
  mode: ReactionRoleMode;
  style: ReactionRoleStyle;
  content: MessageTemplate;
}

export interface AddItemInput {
  panelId: string;
  roleId: string;
  emoji?: string | null;
  label: string;
  description?: string | null;
}

/** A guild pode ainda não ter linha própria (FK de `reaction_role_panels`). */
async function ensureGuild(db: DbExecutor, guildId: string): Promise<void> {
  await db
    .insert(guilds)
    .values({ id: guildId, name: '', ownerId: '' })
    .onConflictDoNothing({ target: guilds.id });
}

export async function listPanels(
  db: DbExecutor,
  guildId: string,
): Promise<ReactionRolePanel[]> {
  return db
    .select()
    .from(reactionRolePanels)
    .where(eq(reactionRolePanels.guildId, guildId))
    .orderBy(asc(reactionRolePanels.createdAt));
}

export async function countPanels(db: DbExecutor, guildId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(reactionRolePanels)
    .where(eq(reactionRolePanels.guildId, guildId));
  return row?.count ?? 0;
}

export async function listPanelItems(
  db: DbExecutor,
  panelId: string,
): Promise<ReactionRoleItem[]> {
  return db
    .select()
    .from(reactionRoleItems)
    .where(eq(reactionRoleItems.panelId, panelId))
    .orderBy(asc(reactionRoleItems.position), asc(reactionRoleItems.label));
}

/** Quantos cargos cada painel da guild tem — evita um SELECT por painel. */
export async function countItemsByPanel(
  db: DbExecutor,
  guildId: string,
): Promise<Map<string, number>> {
  const rows = await db
    .select({ panelId: reactionRoleItems.panelId, count: sql<number>`count(*)::int` })
    .from(reactionRoleItems)
    .innerJoin(reactionRolePanels, eq(reactionRolePanels.id, reactionRoleItems.panelId))
    .where(eq(reactionRolePanels.guildId, guildId))
    .groupBy(reactionRoleItems.panelId);
  return new Map(rows.map((row) => [row.panelId, row.count]));
}

async function withItems(
  db: DbExecutor,
  panel: ReactionRolePanel | undefined,
): Promise<PanelWithItems | null> {
  if (!panel) return null;
  return { ...panel, items: await listPanelItems(db, panel.id) };
}

export async function getPanel(
  db: DbExecutor,
  guildId: string,
  panelId: string,
): Promise<PanelWithItems | null> {
  const [row] = await db
    .select()
    .from(reactionRolePanels)
    .where(and(eq(reactionRolePanels.guildId, guildId), eq(reactionRolePanels.id, panelId)))
    .limit(1);
  return withItems(db, row);
}

/** Usado pelo estilo `reactions`, que só conhece a mensagem que foi reagida. */
export async function getPanelByMessage(
  db: DbExecutor,
  messageId: string,
): Promise<PanelWithItems | null> {
  const [row] = await db
    .select()
    .from(reactionRolePanels)
    .where(eq(reactionRolePanels.messageId, messageId))
    .limit(1);
  return withItems(db, row);
}

export async function createPanel(
  db: DbExecutor,
  input: CreatePanelInput,
): Promise<ReactionRolePanel> {
  await ensureGuild(db, input.guildId);
  const [row] = await db.insert(reactionRolePanels).values(input).returning();
  if (!row) throw new Error('INSERT em reaction_role_panels não retornou linha');
  return row;
}

export async function updatePanelContent(
  db: DbExecutor,
  panelId: string,
  content: MessageTemplate,
): Promise<ReactionRolePanel | null> {
  const [row] = await db
    .update(reactionRolePanels)
    .set({ content, updatedAt: sql`now()` })
    .where(eq(reactionRolePanels.id, panelId))
    .returning();
  return row ?? null;
}

/** Grava a mensagem publicada; `channelId` muda quando o painel é republicado. */
export async function setPanelMessage(
  db: DbExecutor,
  panelId: string,
  channelId: string,
  messageId: string,
): Promise<ReactionRolePanel | null> {
  const [row] = await db
    .update(reactionRolePanels)
    .set({ channelId, messageId, updatedAt: sql`now()` })
    .where(eq(reactionRolePanels.id, panelId))
    .returning();
  return row ?? null;
}

export async function deletePanel(
  db: DbExecutor,
  guildId: string,
  panelId: string,
): Promise<ReactionRolePanel | null> {
  const [row] = await db
    .delete(reactionRolePanels)
    .where(and(eq(reactionRolePanels.guildId, guildId), eq(reactionRolePanels.id, panelId)))
    .returning();
  return row ?? null;
}

/** `null` quando o cargo já está no painel (índice único `panel_id,role_id`). */
export async function addPanelItem(
  db: DbExecutor,
  input: AddItemInput,
): Promise<ReactionRoleItem | null> {
  const [position] = await db
    .select({ next: sql<number>`coalesce(max(${reactionRoleItems.position}), -1) + 1` })
    .from(reactionRoleItems)
    .where(eq(reactionRoleItems.panelId, input.panelId));

  const [row] = await db
    .insert(reactionRoleItems)
    .values({ ...input, position: position?.next ?? 0 })
    .onConflictDoNothing({ target: [reactionRoleItems.panelId, reactionRoleItems.roleId] })
    .returning();
  return row ?? null;
}

export async function removePanelItem(
  db: DbExecutor,
  panelId: string,
  roleId: string,
): Promise<ReactionRoleItem | null> {
  const [row] = await db
    .delete(reactionRoleItems)
    .where(and(eq(reactionRoleItems.panelId, panelId), eq(reactionRoleItems.roleId, roleId)))
    .returning();
  return row ?? null;
}
