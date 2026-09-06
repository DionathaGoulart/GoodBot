import config from './config';
import help from './help';
import { moderationCommands } from './moderation/index';
import logs from './moderation/logs';
import ping from './ping';

import type { AnyCommand } from '../lib/command';

/**
 * Lista explícita (não um glob): o build é um bundle único via tsup, então os
 * comandos precisam ser importados estaticamente. Novo comando → nova linha.
 */
export const commands: readonly AnyCommand[] = [ping, help, config, ...moderationCommands, logs];
