import type { BotContext } from './command';
import type { ClientEvents } from 'discord.js';

export interface EventHandler<K extends keyof ClientEvents = keyof ClientEvents> {
  name: K;
  /** `true` → registrado com `client.once` (ex.: `clientReady`). */
  once?: boolean;
  /**
   * `true` → roda mesmo em guild que o bot **não** atende (plano, Etapa 8).
   *
   * É a exceção, e ela existe para os eventos que decidem o próprio estado do
   * registro: `guildCreate` é quem cria a linha `pending`, `guildDelete` é
   * quem marca a saída. Gatear esses dois seria trancar a porta por dentro.
   */
  always?: boolean;
  execute(ctx: BotContext, ...args: ClientEvents[K]): Promise<void> | void;
}

export function defineEvent<K extends keyof ClientEvents>(
  name: K,
  execute: (ctx: BotContext, ...args: ClientEvents[K]) => Promise<void> | void,
  options: { once?: boolean; always?: boolean } = {},
): EventHandler<K> {
  return { name, execute, once: options.once ?? false, always: options.always ?? false };
}
