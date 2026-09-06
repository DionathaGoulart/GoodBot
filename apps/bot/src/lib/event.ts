import type { BotContext } from './command';
import type { ClientEvents } from 'discord.js';

export interface EventHandler<K extends keyof ClientEvents = keyof ClientEvents> {
  name: K;
  /** `true` → registrado com `client.once` (ex.: `clientReady`). */
  once?: boolean;
  execute(ctx: BotContext, ...args: ClientEvents[K]): Promise<void> | void;
}

export function defineEvent<K extends keyof ClientEvents>(
  name: K,
  execute: (ctx: BotContext, ...args: ClientEvents[K]) => Promise<void> | void,
  options: { once?: boolean } = {},
): EventHandler<K> {
  return { name, execute, once: options.once ?? false };
}
