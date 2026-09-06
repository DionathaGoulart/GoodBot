import { automodGuildMemberAdd } from './members';
import { automodMessageCreate, automodMessageUpdate } from './messages';

import type { EventHandler } from '../../lib/event';

/** Eventos do módulo `automod` (PRD §5.2). Lista explícita, como os comandos. */
export const automodEvents: readonly EventHandler[] = [
  automodMessageCreate,
  automodMessageUpdate,
  automodGuildMemberAdd,
];
