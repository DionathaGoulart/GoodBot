import bora from './bora';
import reactionrole from './reactionrole';
import social from './social';
import squad from './squad';
import { tag, tags } from './tag';
import ticket from './ticket';
import verify from './verify';
import welcome from './welcome';

import type { AnyCommand } from '../../lib/command';

/** Módulos de comunidade (PRD §5.5). Lista explícita, como os outros. */
export const communityCommands: readonly AnyCommand[] = [
  welcome,
  verify,
  reactionrole,
  social,
  ticket,
  squad,
  bora,
  tag,
  tags,
];
