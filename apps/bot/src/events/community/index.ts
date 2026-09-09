import { welcomeMemberAdd, welcomeMemberBoost, welcomeMemberRemove } from './members';
import { reactionRoleAdd, reactionRoleRemove } from './reaction-roles';

import type { EventHandler } from '../../lib/event';

/** Eventos dos módulos de comunidade (PRD §5.5). */
export const communityEvents: readonly EventHandler[] = [
  welcomeMemberAdd,
  welcomeMemberRemove,
  welcomeMemberBoost,
  reactionRoleAdd,
  reactionRoleRemove,
];
