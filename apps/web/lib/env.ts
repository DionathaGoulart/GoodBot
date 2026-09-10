import 'server-only';

import { isSnowflake } from '@goodbot/shared';
import { z } from 'zod';

// O `.env` da raiz é carregado pelo Node (`--env-file-if-exists` nos scripts
// do pacote), igual ao bot. Na Vercel as variáveis vêm do projeto e o arquivo
// não existe.

const snowflake = z.string().refine(isSnowflake, 'não é um snowflake válido');

const EnvSchema = z.object({
  DISCORD_CLIENT_ID: snowflake,
  DISCORD_CLIENT_SECRET: z.string().min(1, 'obrigatório: Developer Portal → OAuth2'),
  GUILD_ID: snowflake,
  /** Painel usa o pooler pgBouncer em produção (PRD §7.2). */
  DATABASE_URL: z.string().min(1),
  INTERNAL_API_URL: z.url(),
  INTERNAL_API_TOKEN: z.string().min(32, 'gere com: openssl rand -hex 32 (≥ 32 caracteres)'),
  AUTH_SECRET: z.string().min(32, 'gere com: openssl rand -base64 32'),
  AUTH_URL: z.url(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

/**
 * Valida `process.env` na primeira leitura. É preguiçoso de propósito: uma
 * página estática (`/login`) não precisa das variáveis, e o build não deve
 * quebrar por causa delas.
 */
export function env(): Env {
  if (cached) return cached;

  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  · ${issue.path.join('.') || '(raiz)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Variáveis de ambiente inválidas:\n${issues}\n\nVeja o .env.example.`);
  }

  cached = result.data;
  return cached;
}
