import { bigserial, boolean, index, integer, jsonb, pgTable, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { createdAt, snowflake, text, timestamptz, updatedAt } from './_columns';
import { socialKindEnum, socialPlatformEnum } from './enums';
import { guilds } from './guilds';

import type { MessageTemplate, SocialKind } from '@cobot/shared';

const guildRef = () =>
  snowflake('guild_id')
    .notNull()
    .references(() => guilds.id, { onDelete: 'cascade' });

/**
 * Uma conta observada pelo job de redes sociais (PRD §5.8). `external_id` é o
 * que a plataforma usa para identificar o perfil (`channel_id` do YouTube,
 * `user_login` da Twitch, `ig_user_id` do Instagram).
 */
export const socialAccounts = pgTable(
  'social_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: guildRef(),
    platform: socialPlatformEnum('platform').notNull(),
    externalId: text('external_id').notNull(),
    /** `@handle`, só para exibição. */
    handle: text('handle'),
    displayName: text('display_name'),
    discordChannelId: snowflake('discord_channel_id').notNull(),
    kinds: socialKindEnum('kinds')
      .array()
      .notNull()
      .$type<SocialKind[]>()
      .default([] as SocialKind[]),
    template: jsonb('template').$type<MessageTemplate>().notNull(),
    mentionRoleId: snowflake('mention_role_id'),
    enabled: boolean('enabled').notNull().default(true),
    pollIntervalSeconds: integer('poll_interval_s').notNull().default(300),
    lastCheckedAt: timestamptz('last_checked_at'),
    /** Última publicação vista; o job usa para não reprocessar o feed inteiro. */
    lastExternalId: text('last_external_id'),
    /** Falhas seguidas. Zera no primeiro sucesso; em 10 a conta se desliga. */
    failureCount: integer('failure_count').notNull().default(0),
    /** Por que o bot desligou a conta sozinho; `null` quando foi um humano. */
    disabledReason: text('disabled_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('social_accounts_guild_platform_external_uidx').on(
      t.guildId,
      t.platform,
      t.externalId,
    ),
    index('social_accounts_due_idx').on(t.enabled, t.lastCheckedAt),
  ],
);

/**
 * Toda publicação já vista. A linha nasce **antes** do envio: se o bot cair no
 * meio, o restart encontra a linha e não anuncia de novo. A unique
 * `(account_id, external_id)` é a trava de verdade contra duplicata (PRD §5.8).
 */
export const socialPosts = pgTable(
  'social_posts',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    guildId: guildRef(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => socialAccounts.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    kind: socialKindEnum('kind').notNull(),
    url: text('url').notNull(),
    title: text('title'),
    publishedAt: timestamptz('published_at'),
    /** `null` enquanto o anúncio não foi enviado (ou falhou). */
    announcedAt: timestamptz('announced_at'),
    messageId: snowflake('message_id'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('social_posts_account_external_uidx').on(t.accountId, t.externalId),
    index('social_posts_guild_created_idx').on(t.guildId, t.createdAt),
  ],
);
