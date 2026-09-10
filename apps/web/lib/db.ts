import 'server-only';

import { createDb } from '@goodbot/db';

import { env } from './env';

// Pool de 1: em produção o painel roda serverless na Vercel e fala com o
// pooler pgBouncer do Supabase (PRD §7.2) — quem faz pool é ele, não nós.
// O singleton sobrevive ao HMR do dev, que reavalia o módulo a cada edição.
const globalForDb = globalThis as unknown as { goodbotDb?: ReturnType<typeof createDb> };

function connection() {
  globalForDb.goodbotDb ??= createDb(env().DATABASE_URL, { max: 1, idleTimeout: 10 });
  return globalForDb.goodbotDb;
}

export function db() {
  return connection().db;
}
