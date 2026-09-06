import config from './config';
import help from './help';
import ping from './ping';

import type { Command } from '../lib/command';

/**
 * Lista explícita (não um glob): o build é um bundle único via tsup, então os
 * comandos precisam ser importados estaticamente. Novo comando → nova linha.
 */
export const commands: readonly Command[] = [ping, help, config];
