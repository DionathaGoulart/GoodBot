import { Collection } from 'discord.js';

import { childLogger } from '../logger';
import { recordError } from './error-log';
import { metrics } from '../metrics';

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

/**
 * De qual guild é este evento, se é que é de alguma.
 *
 * O gateway entrega formas diferentes por evento (mensagem, membro, canal,
 * reação...), e todas as que interessam carregam `guildId` ou um `guild`. O
 * que **não** casa aqui é de propósito: `guildCreate`/`guildDelete` recebem a
 * própria `Guild` (sem `guildId`), e evento de shard ou de erro não tem guild
 * nenhuma — os dois casos devem rodar sempre.
 */
export function guildIdOfEvent(args: readonly unknown[]): string | null {
  for (const arg of args) {
    if (!arg || typeof arg !== 'object') continue;
    const value = arg as { guildId?: unknown; guild?: unknown };
    if (typeof value.guildId === 'string') return value.guildId;
    const guild = value.guild;
    if (guild && typeof guild === 'object' && typeof (guild as { id?: unknown }).id === 'string') {
      return (guild as { id: string }).id;
    }
  }
  return null;
}

/** Registra os handlers no client, isolando exceções de cada evento. */
export function loadEvents(client: Client, events: readonly EventHandler[], ctx: BotContext): void {
  for (const event of events) {
    const bind = (event.once ? client.once : client.on).bind(client) as (
      name: string,
      listener: (...args: unknown[]) => void,
    ) => unknown;
    bind(event.name, (...args: unknown[]) => {
      // O contador conta o que **chegou**, inclusive o que foi descartado
      // logo abaixo: é assim que um servidor não atendido e falante aparece
      // no `/metrics` em vez de sumir.
      metrics.events.inc({ event: event.name });

      // O registro tem de valer aqui, e não só nas interações (plano, Etapa
      // 8). O gateway não filtra por servidor: sem este guarda, um servidor
      // que só apertou "adicionar" e ainda espera aprovação já alimentaria o
      // `message_cache` — com conteúdo de mensagem — e as estatísticas. Nunca
      // guardamos dado de quem não autorizou.
      if (!event.always) {
        const guildId = guildIdOfEvent(args);
        if (guildId !== null && !ctx.registry.serves(guildId)) return;
      }

      void Promise.resolve()
        .then(() => event.execute(ctx, ...(args as never)))
        .catch((error: unknown) => {
          // Um evento que explode nunca pode derrubar o processo (PRD §7.5).
          recordError('event', error, { where: String(event.name) });
          log.error({ err: error, event: event.name }, 'erro no handler de evento');
        });
    });
  }
  log.debug({ count: events.length }, 'eventos registrados');
}
