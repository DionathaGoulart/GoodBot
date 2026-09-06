import { tag, tags } from './tag';
import verify from './verify';
import welcome from './welcome';

import type { AnyCommand } from '../../lib/command';

/** Módulos de comunidade (PRD §5.5). Lista explícita, como os outros. */
export const communityCommands: readonly AnyCommand[] = [welcome, verify, tag, tags];
