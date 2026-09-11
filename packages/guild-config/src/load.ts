import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SnowflakeSchema } from '@goodbot/shared';
import { parse } from 'yaml';
import { z } from 'zod';

import { GuildSpecSchema } from './schema';

import type { GuildSpec } from './schema';

/** `packages/guild-config/src` → raiz do repositório. */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export const SERVERS_DIR = join(REPO_ROOT, 'infra', 'discord');

/**
 * Os segredos de cada servidor ficam num `.env` ao lado do `guild.yaml`, fora
 * do versionamento. O `guild.yaml` é público; isto aqui nunca é.
 */
const ServerEnvSchema = z.object({
  GUILD_ID: SnowflakeSchema,
  /**
   * Quem assina as mudanças. Opcional: sem ele o `apply` usa o **dono** do
   * servidor, que o bot já informa em `/admin/guilds`.
   *
   * O campo é exigido pela API porque lá ele é uma fronteira real — o painel é
   * multi-usuário, e o token sozinho não diz quem clicou. Por aqui quem tem o
   * token é você, então pedir o ID de novo seria burocracia sem ganho. Quem
   * aparece no audit log do Discord é o `reason`, não este campo.
   */
  ACTOR_ID: SnowflakeSchema.optional(),
  INTERNAL_API_URL: z.url(),
  INTERNAL_API_TOKEN: z.string().min(1),
});
export type ServerEnv = z.infer<typeof ServerEnvSchema>;

export interface LoadedServer {
  slug: string;
  dir: string;
  spec: GuildSpec;
  env: ServerEnv;
}

export class ConfigError extends Error {}

/**
 * A API do bot e nada mais. É o que o `scan` precisa: ele descobre a guild
 * pelo nome e a pasta do servidor ainda nem existe quando ele roda.
 */
const ApiEnvSchema = z.object({
  INTERNAL_API_URL: z.url(),
  INTERNAL_API_TOKEN: z.string().min(1),
});
export type ApiEnv = z.infer<typeof ApiEnvSchema>;

/** `KEY=valor`, com `#` de comentário e aspas opcionais. Sem dependência. */
export function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key !== '') out[key] = value;
  }
  return out;
}

/**
 * Uma pasta com `.env` mas ainda sem `guild.yaml` conta: é exatamente o estado
 * de quem acabou de criar o servidor e vai rodar `import`.
 */
export function listServers(): string[] {
  if (!existsSync(SERVERS_DIR)) return [];
  return readdirSync(SERVERS_DIR, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        (existsSync(join(SERVERS_DIR, entry.name, 'guild.yaml')) ||
          existsSync(join(SERVERS_DIR, entry.name, '.env'))),
    )
    .map((entry) => entry.name)
    .sort();
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  ${issue.path.join('.') || '(raiz)'}: ${issue.message}`)
    .join('\n');
}

export function loadSpec(path: string): GuildSpec {
  if (!existsSync(path)) throw new ConfigError(`Arquivo não encontrado: ${path}`);
  let raw: unknown;
  try {
    raw = parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new ConfigError(`YAML inválido em ${path}:\n  ${(error as Error).message}`);
  }
  const parsed = GuildSpecSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    throw new ConfigError(`Spec inválido em ${path}:\n${formatIssues(parsed.error)}`);
  }
  return parsed.data;
}

/**
 * O `.env` do servidor tem prioridade sobre o ambiente do processo: quem roda
 * com dois servidores configurados não quer que uma variável exportada no
 * shell vaze de um para o outro.
 */
/**
 * Só os segredos do servidor, sem exigir o `guild.yaml` — é o que o `import`
 * precisa, já que ele existe justamente para escrever esse arquivo.
 */
export function loadServerEnv(slug: string): { dir: string; env: ServerEnv } {
  const dir = join(SERVERS_DIR, slug);
  if (!existsSync(dir)) {
    const disponiveis = listServers();
    const dica = disponiveis.length > 0 ? ` Disponíveis: ${disponiveis.join(', ')}.` : '';
    throw new ConfigError(`Servidor "${slug}" não existe em infra/discord.${dica}`);
  }

  const envPath = join(dir, '.env');
  const fromFile = existsSync(envPath) ? parseEnvFile(readFileSync(envPath, 'utf8')) : {};
  // Chave com valor vazio no arquivo do servidor é "não preenchi", não "apague
  // o que veio da raiz". Sem esta linha, um `INTERNAL_API_URL=` deixado no
  // modelo derrubaria a URL boa que o .env da raiz acabou de exportar.
  const preenchidas = Object.fromEntries(
    Object.entries(fromFile).filter(([, value]) => value !== ''),
  );
  const merged = { ...process.env, ...preenchidas };

  const env = ServerEnvSchema.safeParse(merged);
  if (!env.success) {
    throw new ConfigError(
      `Configuração incompleta de "${slug}". Preencha ${envPath}:\n${formatIssues(env.error)}`,
    );
  }

  return { dir, env: env.data };
}

export function loadServer(slug: string): LoadedServer {
  const { dir, env } = loadServerEnv(slug);
  return { slug, dir, spec: loadSpec(join(dir, 'guild.yaml')), env };
}

/**
 * Carrega o `.env` da raiz no ambiente do processo, sem sobrescrever o que já
 * estiver exportado no shell.
 *
 * O `.env` da raiz é onde `INTERNAL_API_URL` e `INTERNAL_API_TOKEN` já vivem
 * para o resto do monorepo; repetir os dois em cada `infra/discord/<slug>/.env`
 * seria copiar um segredo para mais lugares por nenhum motivo.
 */
export function loadRootEnv(): void {
  const path = join(REPO_ROOT, '.env');
  if (!existsSync(path)) return;
  for (const [key, value] of Object.entries(parseEnvFile(readFileSync(path, 'utf8')))) {
    process.env[key] ??= value;
  }
}

export function loadApiEnv(): ApiEnv {
  const parsed = ApiEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new ConfigError(
      `Configuração incompleta. Preencha no .env da raiz:\n${formatIssues(parsed.error)}`,
    );
  }
  return parsed.data;
}
