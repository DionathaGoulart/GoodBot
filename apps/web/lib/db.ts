import 'server-only';

import { createDb } from '@goodbot/db';

import { env } from './env';

// Pool de 1: em produção o painel roda serverless na Vercel e fala com o
// pooler do Supabase (PRD §7.2) — quem faz pool é ele, não nós.
// O singleton sobrevive ao HMR do dev, que reavalia o módulo a cada edição.
const globalForDb = globalThis as unknown as { goodbotDb?: ReturnType<typeof createDb> };

function connection() {
  globalForDb.goodbotDb ??= createDb(env().DATABASE_URL, {
    max: 1,
    idleTimeout: 10,
    // O painel **precisa** falar com o pooler em modo transação (porta 6543).
    // No modo sessão cada função da Vercel prende uma conexão de servidor
    // inteira, e o teto do pool (15, menos as 5 do bot) vira teto de requests
    // simultâneos: da décima primeira em diante cada uma espera os 10s do
    // `connect_timeout` antes de conseguir conectar. Em modo transação a
    // conexão é emprestada por query, mas prepared statement não sobrevive à
    // troca — por isso `prepare: false`.
    prepare: false,
  });
  return globalForDb.goodbotDb;
}

export function db() {
  return connection().db;
}
