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
  /** Quem assina as mudanças: precisa ser admin (ou dono) da guild. */
  ACTOR_ID: SnowflakeSchema,
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

export function listServers(): string[] {
  if (!existsSync(SERVERS_DIR)) return [];
  return readdirSync(SERVERS_DIR, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && existsSync(join(SERVERS_DIR, entry.name, 'guild.yaml')),
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
export function loadServer(slug: string): LoadedServer {
  const dir = join(SERVERS_DIR, slug);
  if (!existsSync(dir)) {
    const disponiveis = listServers();
    const dica = disponiveis.length > 0 ? ` Disponíveis: ${disponiveis.join(', ')}.` : '';
    throw new ConfigError(`Servidor "${slug}" não existe em infra/discord.${dica}`);
  }

  const spec = loadSpec(join(dir, 'guild.yaml'));

  const envPath = join(dir, '.env');
  const fromFile = existsSync(envPath) ? parseEnvFile(readFileSync(envPath, 'utf8')) : {};
  const merged = { ...process.env, ...fromFile };

  const env = ServerEnvSchema.safeParse(merged);
  if (!env.success) {
    throw new ConfigError(
      `Configuração incompleta de "${slug}". Preencha ${envPath}:\n${formatIssues(env.error)}`,
    );
  }

  return { slug, dir, spec, env: env.data };
}
