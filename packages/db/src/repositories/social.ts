import { and, asc, eq, isNull, lt, or, sql } from 'drizzle-orm';

import { guilds } from '../schema/guilds';
import { socialAccounts, socialPosts } from '../schema/social';

import type { DbExecutor } from '../client';
import type { SocialAccount, SocialPost } from '../types';
import type { MessageTemplate, SocialKind, SocialPlatform } from '@cobot/shared';

export interface SocialAccountInputRow {
  platform: SocialPlatform;
  externalId: string;
  handle: string | null;
  displayName: string | null;
  discordChannelId: string;
  kinds: SocialKind[];
  template: MessageTemplate;
  mentionRoleId: string | null;
  enabled: boolean;
  pollIntervalSeconds: number;
}

/** A guild pode ainda não ter linha própria (FK de `social_accounts`). */
async function ensureGuild(db: DbExecutor, guildId: string): Promise<void> {
  await db
    .insert(guilds)
    .values({ id: guildId, name: '', ownerId: '' })
    .onConflictDoNothing({ target: guilds.id });
}

export async function listSocialAccounts(
  db: DbExecutor,
  guildId: string,
): Promise<SocialAccount[]> {
  return db
    .select()
    .from(socialAccounts)
    .where(eq(socialAccounts.guildId, guildId))
    .orderBy(asc(socialAccounts.platform), asc(socialAccounts.createdAt));
}

export async function countSocialAccounts(db: DbExecutor, guildId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(socialAccounts)
    .where(eq(socialAccounts.guildId, guildId));
  return row?.count ?? 0;
}

export async function getSocialAccount(
  db: DbExecutor,
  guildId: string,
  id: string,
): Promise<SocialAccount | null> {
  const [row] = await db
    .select()
    .from(socialAccounts)
    .where(and(eq(socialAccounts.guildId, guildId), eq(socialAccounts.id, id)))
    .limit(1);
  return row ?? null;
}

/** `null` quando a guild já observa essa conta (unique guild+platform+external). */
export async function createSocialAccount(
  db: DbExecutor,
  guildId: string,
  input: SocialAccountInputRow,
): Promise<SocialAccount | null> {
  await ensureGuild(db, guildId);
  const [row] = await db
    .insert(socialAccounts)
    .values({ ...input, guildId })
    .onConflictDoNothing({
      target: [socialAccounts.guildId, socialAccounts.platform, socialAccounts.externalId],
    })
    .returning();
  return row ?? null;
}

/**
 * Edição pelo painel ou pelo comando. Reativar uma conta limpa o contador de
 * falhas e o motivo — senão a próxima falha isolada a desligaria na hora.
 */
export async function updateSocialAccount(
  db: DbExecutor,
  guildId: string,
  id: string,
  input: SocialAccountInputRow,
): Promise<SocialAccount | null> {
  const [row] = await db
    .update(socialAccounts)
    .set({
      ...input,
      ...(input.enabled ? { failureCount: 0, disabledReason: null } : {}),
      updatedAt: sql`now()`,
    })
    .where(and(eq(socialAccounts.guildId, guildId), eq(socialAccounts.id, id)))
    .returning();
  return row ?? null;
}

export async function deleteSocialAccount(
  db: DbExecutor,
  guildId: string,
  id: string,
): Promise<SocialAccount | null> {
  const [row] = await db
    .delete(socialAccounts)
    .where(and(eq(socialAccounts.guildId, guildId), eq(socialAccounts.id, id)))
    .returning();
  return row ?? null;
}

/**
 * Contas ligadas cujo intervalo já venceu, de todas as guilds. O job roda uma
 * vez por minuto e pega só o que está devendo checagem — é o que mantém uma
 * conta de 5 min e outra de 1 h no mesmo laço sem cron por conta.
 */
export async function listDueSocialAccounts(
  db: DbExecutor,
  now: Date,
  limit = 25,
): Promise<SocialAccount[]> {
  return db
    .select()
    .from(socialAccounts)
    .where(
      and(
        eq(socialAccounts.enabled, true),
        or(
          isNull(socialAccounts.lastCheckedAt),
          lt(
            socialAccounts.lastCheckedAt,
            sql`${now} - make_interval(secs => ${socialAccounts.pollIntervalSeconds})`,
          ),
        ),
      ),
    )
    .orderBy(asc(socialAccounts.lastCheckedAt))
    .limit(limit);
}

/** Marca a passada como feita. Chamado mesmo quando a checagem falhou. */
export async function touchSocialAccount(
  db: DbExecutor,
  id: string,
  checkedAt: Date,
  lastExternalId?: string,
): Promise<void> {
  await db
    .update(socialAccounts)
    .set({
      lastCheckedAt: checkedAt,
      ...(lastExternalId === undefined ? {} : { lastExternalId }),
    })
    .where(eq(socialAccounts.id, id));
}

export async function resetSocialFailures(db: DbExecutor, id: string): Promise<void> {
  await db
    .update(socialAccounts)
    .set({ failureCount: 0, disabledReason: null })
    .where(and(eq(socialAccounts.id, id), sql`${socialAccounts.failureCount} > 0`));
}

/**
 * Soma uma falha e desliga a conta ao bater o teto. Devolve a linha já
 * atualizada para quem chamou decidir se manda alerta.
 */
export async function recordSocialFailure(
  db: DbExecutor,
  id: string,
  maxFailures: number,
  reason: string,
): Promise<SocialAccount | null> {
  const [row] = await db
    .update(socialAccounts)
    .set({
      failureCount: sql`${socialAccounts.failureCount} + 1`,
      enabled: sql`case when ${socialAccounts.failureCount} + 1 >= ${maxFailures} then false else ${socialAccounts.enabled} end`,
      disabledReason: sql`case when ${socialAccounts.failureCount} + 1 >= ${maxFailures} then ${reason} else ${socialAccounts.disabledReason} end`,
      updatedAt: sql`now()`,
    })
    .where(eq(socialAccounts.id, id))
    .returning();
  return row ?? null;
}

export interface NewSocialPostInput {
  guildId: string;
  accountId: string;
  externalId: string;
  kind: SocialKind;
  url: string;
  title: string | null;
  publishedAt: Date | null;
}

/**
 * Reserva a publicação antes do envio. `null` = a unique
 * `(account_id, external_id)` recusou, ou seja, alguém (ou o próprio bot antes
 * de um restart) já viu essa publicação e ela **não** deve ser anunciada de
 * novo. É a trava de idempotência do PRD §5.8.
 */
export async function claimSocialPost(
  db: DbExecutor,
  input: NewSocialPostInput,
): Promise<SocialPost | null> {
  const [row] = await db
    .insert(socialPosts)
    .values(input)
    .onConflictDoNothing({ target: [socialPosts.accountId, socialPosts.externalId] })
    .returning();
  return row ?? null;
}

export async function markSocialPostAnnounced(
  db: DbExecutor,
  id: number,
  messageId: string,
): Promise<void> {
  await db
    .update(socialPosts)
    .set({ announcedAt: new Date(), messageId })
    .where(eq(socialPosts.id, id));
}

/**
 * Desfaz a reserva quando o envio falhou de vez. Sem isto uma indisponibilidade
 * do Discord faria a publicação ser marcada como vista e nunca anunciada.
 */
export async function releaseSocialPost(db: DbExecutor, id: number): Promise<void> {
  await db.delete(socialPosts).where(eq(socialPosts.id, id));
}

export async function listRecentSocialPosts(
  db: DbExecutor,
  accountId: string,
  limit = 5,
): Promise<SocialPost[]> {
  return db
    .select()
    .from(socialPosts)
    .where(eq(socialPosts.accountId, accountId))
    .orderBy(sql`${socialPosts.createdAt} desc`)
    .limit(limit);
}

/** Job de retenção: `social_posts` guarda 90 dias (PRD §8). */
export async function deleteSocialPostsBefore(db: DbExecutor, before: Date): Promise<number> {
  const rows = await db
    .delete(socialPosts)
    .where(lt(socialPosts.createdAt, before))
    .returning({ id: socialPosts.id });
  return rows.length;
}
