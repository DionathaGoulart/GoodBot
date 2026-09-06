import { isSnowflake } from '@cobot/shared';
import { z } from 'zod';

// O `.env` da raiz é carregado pelo próprio Node (`--env-file-if-exists` nos
// scripts `dev`/`start`), não por uma lib: assim nada de CJS entra no bundle.
// Em produção as variáveis vêm do Compose e o arquivo simplesmente não existe.

const snowflake = z.string().refine(isSnowflake, 'não é um snowflake válido');

const EnvSchema = z.object({
  DISCORD_TOKEN: z.string().min(1, 'obrigatório: Developer Portal → Bot → Reset Token'),
  DISCORD_CLIENT_ID: snowflake,
  GUILD_ID: snowflake,
  DATABASE_URL: z.string().min(1),
  /** Única barreira da API do bot na internet (PRD §7.3): openssl rand -hex 32. */
  INTERNAL_API_TOKEN: z.string().min(32, 'gere com: openssl rand -hex 32 (≥ 32 caracteres)'),
  INTERNAL_API_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  TZ: z.string().default('America/Sao_Paulo'),
});

export type Env = z.infer<typeof EnvSchema>;

/**
 * Valida `process.env` e falha rápido com uma mensagem legível — melhor morrer
 * no boot do que descobrir um token vazio no meio de um comando.
 */
export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (result.success) return result.data;

  const issues = result.error.issues
    .map((issue) => `  · ${issue.path.join('.') || '(raiz)'}: ${issue.message}`)
    .join('\n');
  throw new Error(`Variáveis de ambiente inválidas:\n${issues}\n\nVeja o .env.example.`);
}

export const env = parseEnv();
export const isProduction = env.NODE_ENV === 'production';
