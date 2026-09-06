import { clientError, clientWarn, shardDisconnect, shardReconnecting, shardResume } from './errors';
import { guildCreate, guildDelete } from './guilds';
import interactionCreate from './interactionCreate';
import ready from './ready';

import type { EventHandler } from '../lib/event';

/** Lista explícita pelo mesmo motivo dos comandos (bundle único). */
export const events: readonly EventHandler[] = [
  ready,
  interactionCreate,
  guildCreate,
  guildDelete,
  clientError,
  clientWarn,
  shardDisconnect,
  shardReconnecting,
  shardResume,
];
