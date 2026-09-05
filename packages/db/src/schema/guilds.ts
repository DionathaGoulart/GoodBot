import { pgTable } from 'drizzle-orm/pg-core';

import { createdAt, snowflake, text, timestamptz } from './_columns';

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
