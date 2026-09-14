import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { createdAt, snowflake, snowflakeArray, text, timestamptz, updatedAt } from './_columns';
import { socialKindEnum, socialPlatformEnum } from './enums';
import { guilds } from './guilds';

import type { MessageTemplate, SocialKind, SocialPlatform } from '@goodbot/shared';

const guildRef = () =>
  snowflake('guild_id')
    .notNull()
    .references(() => guilds.id, { onDelete: 'cascade' });

/**
 * Uma conta observada pelo job de redes sociais (PRD §5.8). `external_id` é o
 * `channel_id` do YouTube (`UC…`), resolvido no cadastro a partir da URL ou do
 * `@handle`. O enum `social_platform` ainda tem os quatro valores da v1, mas
 * `$type` diz a verdade: só `youtube` é escrito.
 */
export const socialAccounts = pgTable(
  'social_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: guildRef(),
    platform: socialPlatformEnum('platform').notNull().$type<SocialPlatform>(),
    externalId: text('external_id').notNull(),
    /** `@handle`, só para exibição. */
    handle: text('handle'),
    displayName: text('display_name'),
    /** Avatar do canal, para a lista do painel. */
    avatarUrl: text('avatar_url'),
    discordChannelId: snowflake('discord_channel_id').notNull(),
    kinds: socialKindEnum('kinds')
      .array()
      .notNull()
      .$type<SocialKind[]>()
      .default([] as SocialKind[]),
    template: jsonb('template').$type<MessageTemplate>().notNull(),
    /** Cargos pingados no anúncio de vídeo e de short; vazio = não pinga. */
    mentionRoleIds: snowflakeArray('mention_role_ids'),
    /** Cargos pingados no anúncio de live. Sem fallback para os de cima. */
    liveMentionRoleIds: snowflakeArray('live_mention_role_ids'),
    enabled: boolean('enabled').notNull().default(true),
    lastCheckedAt: timestamptz('last_checked_at'),
    /**
     * Pausa automática por falhas: até quando o job pula a conta. `null` = a
     * conta roda normalmente. É o que separa "o bot deu um tempo" de "alguém
     * desligou" (`enabled = false`), que o job nunca desfaz.
     */
    pausedUntil: timestamptz('paused_until'),
    /** Falhas seguidas. Zera no primeiro sucesso; a partir de 10 a conta pausa. */
    failureCount: integer('failure_count').notNull().default(0),
    /**
     * Último erro da sequência de falhas; `null` depois de um sucesso ou de um
     * save pelo painel. O nome é da v2, quando a décima falha desligava a conta.
     */
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
  ],
);

/**
 * Toda publicação já vista. A linha nasce **antes** do envio: se o bot cair no
 * meio, o restart encontra a linha e não anuncia de novo. A unique
 * `(account_id, external_id)` é a trava de verdade contra duplicata (PRD §5.8).
 *
 * Não há retenção aqui de propósito: podar a linha faria o vídeo antigo que
 * ainda está no feed voltar a ser "novo" e ser anunciado outra vez.
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
