import { automodEvents } from './automod/index';
import { communityEvents } from './community/index';
import { clientError, clientWarn, shardDisconnect, shardReconnecting, shardResume } from './errors';
import { guildCreate, guildDelete } from './guilds';
import interactionCreate from './interactionCreate';
import { logEvents } from './logs/index';
import ready from './ready';

import type { EventHandler } from '../lib/event';

/** Lista explícita pelo mesmo motivo dos comandos (bundle único). */
export const events: readonly EventHandler[] = [
  ready,
  interactionCreate,
  guildCreate,
  guildDelete,
  ...logEvents,
  ...automodEvents,
  ...communityEvents,
  clientError,
  clientWarn,
  shardDisconnect,
  shardReconnecting,
  shardResume,
];
