import { describe, expect, it } from 'vitest';

import { classifyDeploy, heavierDeploy } from './deploy';

describe('classifyDeploy', () => {
  it.each([
    { name: 'nada mudou', paths: [], kind: 'none' },
    {
      name: 'painel, docs, CI e guild como código não mexem no bot',
      paths: [
        'apps/web/app/admin/page.tsx',
        'docs/runbook.md',
        '.harness/prd.md',
        '.github/workflows/deploy.yml',
        'packages/guild-config/src/plan.ts',
        'infra/discord/goodivers/guild.yaml',
        'CHANGELOG.md',
        '',
      ],
      kind: 'none',
    },
    { name: 'código do bot', paths: ['apps/bot/src/index.ts'], kind: 'restart' },
    { name: 'regra em shared', paths: ['packages/shared/src/squads/stats.ts'], kind: 'restart' },
    { name: 'repositório do db', paths: ['packages/db/src/repositories/meta.ts'], kind: 'restart' },
    { name: 'lockfile', paths: ['pnpm-lock.yaml'], kind: 'restart' },
    {
      name: 'manifest do painel entra no install da imagem',
      paths: ['apps/web/package.json'],
      kind: 'restart',
    },
    { name: 'Dockerfile do bot', paths: ['infra/docker/bot.Dockerfile'], kind: 'restart' },
    {
      name: 'migration nova',
      paths: ['apps/bot/src/index.ts', 'packages/db/drizzle/0020_x.sql'],
      kind: 'database',
    },
    {
      name: 'journal das migrations',
      paths: ['packages/db/drizzle/meta/_journal.json'],
      kind: 'database',
    },
    {
      name: 'compose ganha de tudo',
      paths: ['packages/db/drizzle/0020_x.sql', 'infra/docker-compose.yml'],
      kind: 'infra',
    },
    { name: 'Caddyfile', paths: ['infra/Caddyfile'], kind: 'infra' },
    { name: 'script da VM', paths: ['infra/scripts/deploy-notice.sh'], kind: 'infra' },
    {
      name: 'espaço em volta da linha do git',
      paths: ['  apps/bot/src/index.ts \n'],
      kind: 'restart',
    },
  ])('$name: $kind', ({ paths, kind }) => {
    expect(classifyDeploy(paths)).toBe(kind);
  });
});

describe('heavierDeploy', () => {
  it.each([
    ['none', 'restart', 'restart'],
    ['database', 'restart', 'database'],
    ['infra', 'database', 'infra'],
    ['restart', 'restart', 'restart'],
  ] as const)('%s e %s: %s', (a, b, kind) => {
    expect(heavierDeploy(a, b)).toBe(kind);
    expect(heavierDeploy(b, a)).toBe(kind);
  });
});
