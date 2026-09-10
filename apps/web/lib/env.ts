import 'server-only';

import { isSnowflake } from '@goodbot/shared';
import { z } from 'zod';

// O `.env` da raiz é carregado pelo Node (`--env-file-if-exists` nos scripts
// do pacote), igual ao bot. Na Vercel as variáveis vêm do projeto e o arquivo
// não existe.

const snowflake = z.string().refine(isSnowflake, 'não é um snowflake válido');

// O painel não tem mais variável de guild: quem lista os servidores é o
// registro no banco (`guild_registry`), lido em `lib/registry.ts`.

const EnvSchema = z.object({
  DISCORD_CLIENT_ID: snowflake,
  DISCORD_CLIENT_SECRET: z.string().min(1, 'obrigatório: Developer Portal → OAuth2'),
  /** Painel usa o pooler pgBouncer em produção (PRD §7.2). */
  DATABASE_URL: z.string().min(1),
  INTERNAL_API_URL: z.url(),
  INTERNAL_API_TOKEN: z.string().min(32, 'gere com: openssl rand -hex 32 (≥ 32 caracteres)'),
  AUTH_SECRET: z.string().min(32, 'gere com: openssl rand -base64 32'),
  AUTH_URL: z.url(),
  /**
   * O dono do bot — quem abre `admin.<domínio>`.
   *
   * **Não** é cargo em servidor nenhum, de propósito: quem administra um
   * servidor qualquer viraria administrador do bot inteiro. E é opcional para
   * o painel comum não deixar de subir por causa dela; sem a variável o painel
   * admin simplesmente não abre para ninguém, que é o padrão seguro.
   */
  OWNER_DISCORD_ID: z.preprocess(
    (value) => (value === '' ? undefined : value),
    snowflake.optional(),
  ),
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
