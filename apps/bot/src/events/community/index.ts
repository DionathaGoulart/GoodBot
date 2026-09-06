import { welcomeMemberAdd, welcomeMemberRemove } from './members';

import type { EventHandler } from '../../lib/event';

/** Eventos dos módulos de comunidade (PRD §5.5). */
export const communityEvents: readonly EventHandler[] = [welcomeMemberAdd, welcomeMemberRemove];
