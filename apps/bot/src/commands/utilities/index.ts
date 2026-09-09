import clear from './clear';
import { avatar, roleinfo, serverinfo, userinfo } from './info';
import { lock, lockdown, unlock } from './lock';
import poll from './poll';
import purge from './purge';
import remind from './remind';
import say from './say';
import slowmode from './slowmode';
import stats from './stats';

import type { AnyCommand } from '../../lib/command';

/** Módulo `utilities` (PRD §5.3). Lista explícita, como em `commands/index.ts`. */
export const utilitiesCommands: readonly AnyCommand[] = [
  clear,
  purge,
  slowmode,
  lock,
  unlock,
  lockdown,
  userinfo,
  serverinfo,
  avatar,
  roleinfo,
  remind,
  poll,
  say,
  stats,
];
