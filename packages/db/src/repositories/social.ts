import { and, asc, eq, gt, isNotNull, or, sql } from 'drizzle-orm';

import { guilds } from '../schema/guilds';
import { socialAccounts, socialPosts } from '../schema/social';

import type { DbExecutor } from '../client';
import type { SocialAccount, SocialPost } from '../types';
import type { MessageTemplate, SocialKind, SocialPlatform } from '@goodbot/shared';

export interface SocialAccountInputRow {
  platform: SocialPlatform;
  externalId: string;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  discordChannelId: string;
  kinds: SocialKind[];
  template: MessageTemplate;
  mentionRoleIds: string[];
  liveMentionRoleIds: string[];
  enabled: boolean;
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
    .orderBy(asc(socialAccounts.createdAt));
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
 * Edição pelo painel ou pelo comando. Salvar é uma decisão humana, então zera
 * o contador de falhas, o último erro e a pausa automática: ligada, a conta é
 * tentada já na próxima passada; desligada, o job nem olha para ela. Sem isto
 * quem corrige o canal teria de esperar a pausa vencer para ver o resultado.
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
      failureCount: 0,
      disabledReason: null,
      pausedUntil: null,
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
 * Todas as contas ligadas, de todas as guilds, inclusive as em pausa. O job
 * percorre a lista inteira a cada passada e é ele quem pula a pausa: é ele que
 * tem o relógio (injetável nos testes), e um laço só é mais fácil de entender
 * do que uma query de vencimento.
 */
export async function listEnabledSocialAccounts(db: DbExecutor): Promise<SocialAccount[]> {
  return db
    .select()
    .from(socialAccounts)
    .where(eq(socialAccounts.enabled, true))
    .orderBy(asc(socialAccounts.guildId), asc(socialAccounts.createdAt));
}

/** Marca a passada como feita. Chamado mesmo quando a checagem falhou. */
export async function touchSocialAccount(
  db: DbExecutor,
  id: string,
  checkedAt: Date,
): Promise<void> {
  await db
    .update(socialAccounts)
    .set({ lastCheckedAt: checkedAt })
    .where(eq(socialAccounts.id, id));
}

/** Primeiro sucesso depois de falhas: zera o contador, o erro e a pausa. */
export async function resetSocialFailures(db: DbExecutor, id: string): Promise<void> {
  await db
    .update(socialAccounts)
    .set({ failureCount: 0, disabledReason: null, pausedUntil: null })
    .where(
      and(
        eq(socialAccounts.id, id),
        or(gt(socialAccounts.failureCount, 0), isNotNull(socialAccounts.pausedUntil)),
      ),
    );
}

/**
 * Soma uma falha e guarda o erro. Nunca desliga a conta: quanto tempo ela fica
 * em pausa é conta do job (`pauseSocialAccount`), que tem o relógio. Devolve a
 * linha já atualizada, com o contador novo, para ele decidir.
 */
export async function recordSocialFailure(
  db: DbExecutor,
  id: string,
  reason: string,
): Promise<SocialAccount | null> {
  const [row] = await db
    .update(socialAccounts)
    .set({
      failureCount: sql`${socialAccounts.failureCount} + 1`,
      disabledReason: reason,
      updatedAt: sql`now()`,
    })
    .where(eq(socialAccounts.id, id))
    .returning();
  return row ?? null;
}

/** Tira a conta das passadas até `until`. `enabled` fica como estava. */
export async function pauseSocialAccount(
  db: DbExecutor,
  id: string,
  until: Date,
): Promise<void> {
  await db
    .update(socialAccounts)
    .set({ pausedUntil: until, updatedAt: sql`now()` })
    .where(eq(socialAccounts.id, id));
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

/**
 * Se a publicação já foi vista. Existe para o provider poder **pular** o que já
 * está anunciado antes de gastar requisições classificando: `claimSocialPost`
 * continua sendo quem decide de verdade, este é só o atalho barato.
 */
export async function hasSocialPost(
  db: DbExecutor,
  accountId: string,
  externalId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: socialPosts.id })
    .from(socialPosts)
    .where(and(eq(socialPosts.accountId, accountId), eq(socialPosts.externalId, externalId)))
    .limit(1);
  return row !== undefined;
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
