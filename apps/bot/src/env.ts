import { isSnowflake, parseIdList } from '@goodbot/shared';
import { z } from 'zod';

// O `.env` da raiz é carregado pelo próprio Node (`--env-file-if-exists` nos
// scripts `dev`/`start`), não por uma lib: assim nada de CJS entra no bundle.
// Em produção as variáveis vêm do Compose e o arquivo simplesmente não existe.

const snowflake = z.string().refine(isSnowflake, 'não é um snowflake válido');

/**
 * O `.env.example` documenta as opcionais com o valor vazio, e o Compose
 * repassa `FOO=` como string vazia — que não é "ausente" para o Zod.
 */
const blankToUndefined = (value: unknown): unknown => (value === '' ? undefined : value);

/**
 * Uma ou mais guilds, separadas por vírgula. Aceita tanto `GUILD_IDS` quanto o
 * `GUILD_ID` singular: o token e as variáveis vivem em três cofres diferentes
 * (VM, GitHub Secrets, Vercel), e obrigar a renomear em todos de uma vez só
 * para acrescentar um servidor seria um degrau desnecessário.
 */
const guildIds = z.preprocess(parseIdList, z.array(snowflake).min(1, 'informe ao menos uma guild'));

const EnvSchema = z
  .object({
    DISCORD_TOKEN: z.string().min(1, 'obrigatório: Developer Portal → Bot → Reset Token'),
    DISCORD_CLIENT_ID: snowflake,
    DATABASE_URL: z.string().min(1),
    /** Única barreira da API do bot na internet (PRD §7.3): openssl rand -hex 32. */
    INTERNAL_API_TOKEN: z.string().min(32, 'gere com: openssl rand -hex 32 (≥ 32 caracteres)'),
    INTERNAL_API_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
    /** Webhook de Discord dos alertas operacionais (PRD §11). Opcional em dev. */
    ALERT_WEBHOOK_URL: z.preprocess(blankToUndefined, z.url().optional()),
    /** Volume de backups montado read-only; sem ele o painel não mostra o card. */
    BACKUP_DIR: z.preprocess(blankToUndefined, z.string().optional()),
    // As notificações de rede social não têm variável nenhuma: desde a v2 o
    // módulo só lê páginas públicas do YouTube, sem chave e sem cota (PRD §5.8).
    /** Sha do commit da imagem, injetado pela CI no build (`GIT_SHA`). */
    GIT_SHA: z.preprocess(blankToUndefined, z.string().optional()),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
    TZ: z.string().default('America/Sao_Paulo'),
    GUILD_IDS: guildIds.optional(),
    GUILD_ID: guildIds.optional(),
  })
  .transform(({ GUILD_IDS, GUILD_ID, ...rest }) => ({
    ...rest,
    guildIds: GUILD_IDS ?? GUILD_ID ?? [],
  }))
  .refine((env) => env.guildIds.length > 0, {
    path: ['GUILD_IDS'],
    message: 'obrigatório: um ou mais IDs de servidor, separados por vírgula',
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
