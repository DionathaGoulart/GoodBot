/**
 * O tipo do deploy para a CI: lê a lista de arquivos no stdin e escreve o
 * tipo (`none`, `restart`, `database` ou `infra`) no stdout.
 *
 *   git diff --name-only <no ar> <novo> | pnpm --filter @goodbot/shared --silent deploy-kind
 */
import { readFileSync } from 'node:fs';

import { classifyDeploy } from './deploy';

process.stdout.write(`${classifyDeploy(readFileSync(0, 'utf8').split('\n'))}\n`);
