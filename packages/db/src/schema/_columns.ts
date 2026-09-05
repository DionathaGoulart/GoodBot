import { sql } from 'drizzle-orm';
import { text, timestamp } from 'drizzle-orm/pg-core';

/** `timestamptz` com default `now()`. */
export const createdAt = () =>
  timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow();

export const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** Snowflake do Discord: sempre `text`, nunca número. */
export const snowflake = (name: string) => text(name);

/** `text[]` não nulo, vazio por padrão. */
export const snowflakeArray = (name: string) =>
  text(name)
    .array()
    .notNull()
    .default(sql`'{}'::text[]`);

export { text };
