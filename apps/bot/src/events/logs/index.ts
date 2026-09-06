import {
  guildBanAdd,
  guildBanRemove,
  guildMemberAdd,
  guildMemberRemove,
  guildMemberUpdate,
} from './members';
import { messageCreate, messageDelete, messageDeleteBulk, messageUpdate } from './messages';
import {
  channelCreate,
  channelDelete,
  channelUpdate,
  emojiCreate,
  emojiDelete,
  guildUpdate,
  roleCreate,
  roleDelete,
  roleUpdate,
} from './server';
import { voiceStateUpdate } from './voice';

import type { EventHandler } from '../../lib/event';

/** Eventos do módulo `logs` (PRD §5.4). Lista explícita, como os comandos. */
export const logEvents: readonly EventHandler[] = [
  messageCreate,
  messageUpdate,
  messageDelete,
  messageDeleteBulk,
  guildMemberAdd,
  guildMemberRemove,
  guildMemberUpdate,
  guildBanAdd,
  guildBanRemove,
  channelCreate,
  channelUpdate,
  channelDelete,
  roleCreate,
  roleUpdate,
  roleDelete,
  emojiCreate,
  emojiDelete,
  guildUpdate,
  voiceStateUpdate,
];
