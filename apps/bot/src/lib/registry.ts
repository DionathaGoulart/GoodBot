import { createHash } from 'node:crypto';

import { getCommandsHash, setCommandsHash } from '@cobot/db';
import { REST, Routes } from 'discord.js';

import { childLogger } from '../logger';

import type { Command } from './command';
import type { Db } from '@cobot/db';
import type { RESTPostAPIApplicationCommandsJSONBody } from 'discord.js';

const log = childLogger('registry');

export type CommandManifest = RESTPostAPIApplicationCommandsJSONBody[];

/**
 * Manifesto JSON dos comandos, ordenado por nome para o hash não depender da
 * ordem em que os arquivos foram carregados.
 */
export function buildManifest(commands: Iterable<Command>): CommandManifest {
  return [...commands]
    .map((command) => command.data.toJSON() as RESTPostAPIApplicationCommandsJSONBody)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** SHA-256 estável do manifesto — chaves ordenadas em qualquer profundidade. */
export function hashManifest(manifest: CommandManifest): string {
  return createHash('sha256').update(stableStringify(manifest)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export interface SyncOptions {
  db: Db;
  token: string;
  clientId: string;
  guildId: string;
  commands: Iterable<Command>;
  /** Registra mesmo que o hash não tenha mudado (`--force`). */
  force?: boolean;
}

export type SyncResult =
  | { registered: false; hash: string; count: number }
  | { registered: true; hash: string; count: number };

/**
 * Registra os slash commands como **guild commands** (instantâneos) só quando
 * o manifesto muda — evita queimar o rate limit de registro a cada restart
 * (PRD §7.4).
 */
export async function syncCommands(options: SyncOptions): Promise<SyncResult> {
  const manifest = buildManifest(options.commands);
  const hash = hashManifest(manifest);
  const stored = await getCommandsHash(options.db, options.guildId);

  if (!options.force && stored === hash) {
    log.info({ count: manifest.length, hash: hash.slice(0, 12) }, 'comandos inalterados');
    return { registered: false, hash, count: manifest.length };
  }

  const rest = new REST({ version: '10' }).setToken(options.token);
  await rest.put(Routes.applicationGuildCommands(options.clientId, options.guildId), {
    body: manifest,
  });
  await setCommandsHash(options.db, options.guildId, hash);

  log.info(
    { count: manifest.length, hash: hash.slice(0, 12), forced: options.force ?? false },
    'comandos registrados na guild',
  );
  return { registered: true, hash, count: manifest.length };
}
