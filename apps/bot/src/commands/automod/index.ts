import automod from './automod';
import raid from './raid';

import type { AnyCommand } from '../../lib/command';

/** Módulo `automod` (PRD §5.2). Lista explícita, como em `commands/index.ts`. */
export const automodCommands: readonly AnyCommand[] = [automod, raid];
