import { Collection } from 'discord.js';

import { childLogger } from '../logger';

import type { AnyCommand, BotContext, CommandCollection } from './command';
import type { EventHandler } from './event';
import type { Client } from 'discord.js';

const log = childLogger('loader');

/**
 * Monta a coleção de comandos a partir da lista de `src/commands/index.ts`.
 *
 * A lista é explícita (e não um glob em runtime) porque o build do bot é um
 * bundle único via tsup: não existe `src/commands/*.js` em `dist/` para varrer.
 */
export function loadCommands(commands: readonly AnyCommand[]): CommandCollection {
  const collection: CommandCollection = new Collection();
  for (const command of commands) {
    const name = command.data.name;
    if (collection.has(name)) {
      throw new Error(`Comando duplicado: /${name}`);
    }
    collection.set(name, command);
  }
  log.debug({ count: collection.size }, 'comandos carregados');
  return collection;
}

/** Agrupa comandos por módulo, preservando a ordem de declaração (`/help`). */
export function groupByModule(commands: CommandCollection): Map<string, AnyCommand[]> {
  const groups = new Map<string, AnyCommand[]>();
  for (const command of commands.values()) {
    const list = groups.get(command.module);
    if (list) list.push(command);
    else groups.set(command.module, [command]);
  }
  return groups;
}

/** Registra os handlers no client, isolando exceções de cada evento. */
export function loadEvents(client: Client, events: readonly EventHandler[], ctx: BotContext): void {
  for (const event of events) {
    const bind = (event.once ? client.once : client.on).bind(client) as (
      name: string,
      listener: (...args: unknown[]) => void,
    ) => unknown;
    bind(event.name, (...args: unknown[]) => {
      void Promise.resolve()
        .then(() => event.execute(ctx, ...(args as never)))
        .catch((error: unknown) => {
          // Um evento que explode nunca pode derrubar o processo (PRD §7.5).
          log.error({ err: error, event: event.name }, 'erro no handler de evento');
        });
    });
  }
  log.debug({ count: events.length }, 'eventos registrados');
}
