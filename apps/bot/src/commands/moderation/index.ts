import ban from './ban';
import caseCommand from './case';
import history from './history';
import kick from './kick';
import note from './note';
import punish from './punish';
import reason from './reason';
import softban from './softban';
import timeout from './timeout';
import unban from './unban';
import untimeout from './untimeout';
import warn from './warn';

import type { AnyCommand } from '../../lib/command';

/** Módulo `moderation` (PRD §5.1). Lista explícita, como em `commands/index.ts`. */
export const moderationCommands: readonly AnyCommand[] = [
  ban,
  unban,
  softban,
  kick,
  timeout,
  untimeout,
  warn,
  note,
  reason,
  caseCommand,
  history,
  punish,
];
