import { Hono } from 'hono';

import { isUserContextCommand } from '../../lib/command';

import type { AnyCommand } from '../../lib/command';
import type { ApiDeps, ApiEnv } from '../context';
import type { CommandSummary } from '@goodbot/shared';
import type { APIApplicationCommandOption } from 'discord.js';

/** `1` = subcomando, `2` = grupo de subcomandos (enum do Discord). */
const SUB_COMMAND = 1;
const SUB_COMMAND_GROUP = 2;

/** `ticket abrir`, `ticket fechar`… achatado; grupos entram como `grupo sub`. */
function subcommandNames(options: readonly APIApplicationCommandOption[] = []): string[] {
  const names: string[] = [];
  for (const option of options) {
    if (option.type === SUB_COMMAND) {
      names.push(option.name);
    } else if (option.type === SUB_COMMAND_GROUP) {
      for (const child of option.options ?? []) names.push(`${option.name} ${child.name}`);
    }
  }
  return names;
}

export function toSummary(command: AnyCommand): CommandSummary {
  const data = command.data.toJSON();
  if (isUserContextCommand(command)) {
    return {
      name: data.name,
      description: command.help ?? '',
      module: command.module,
      level: command.level,
      kind: 'user_context',
      subcommands: [],
    };
  }
  const description = 'description' in data ? data.description : '';
  const options = 'options' in data ? (data.options ?? []) : [];
  return {
    name: data.name,
    description: command.help ?? description,
    module: command.module,
    level: command.level,
    kind: 'slash',
    subcommands: subcommandNames(options as APIApplicationCommandOption[]),
  };
}

/**
 * O manifesto vivo dos comandos carregados. A tela de permissões do painel se
 * monta a partir daqui (PRD §6.2), então um comando novo aparece sem precisar
 * de deploy do painel — a lista nunca é duplicada no `apps/web`.
 */
export function createCommandRoutes(deps: ApiDeps): Hono<ApiEnv> {
  return new Hono<ApiEnv>().get('/', (c) => {
    const summaries = [...deps.commands.values()]
      .map(toSummary)
      .sort((a, b) => a.name.localeCompare(b.name));
    return c.json(summaries);
  });
}
