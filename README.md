# CoBot

Bot de moderação para Discord (discord.js v14) + painel web (Next.js) para
configurar e administrar um servidor. Monorepo pnpm em TypeScript, hospedado
numa instância ARM (Oracle Cloud Free Tier) com Docker Compose.

## Estrutura

```
apps/bot          bot Discord + API interna (Hono)
apps/web          painel Next.js (App Router, Tailwind, shadcn/ui, Auth.js)
packages/db       Drizzle: schema e migrations
packages/shared   Zod: schemas, tipos e constantes compartilhados
infra/            docker-compose, Caddy, Dockerfiles, deploy
.harness/         PRD, styleguide e plano de execução (fonte de verdade)
```

## Rodando localmente

Requisitos: Node 22 (`.nvmrc`), pnpm 9 (`corepack enable`), Docker.

```bash
cp .env.example .env            # preencher DISCORD_TOKEN etc.
docker compose -f infra/docker-compose.dev.yml up -d   # só o Postgres
pnpm install
pnpm db:migrate
pnpm dev                        # bot + web em paralelo
```

Validação: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.

## Documentação

- [`.harness/prd.md`](.harness/prd.md) — requisitos, modelo de dados, decisões.
- [`.harness/styleguide.md`](.harness/styleguide.md) — guia visual do painel.
- [`.harness/plan.md`](.harness/plan.md) — plano de execução por etapas.
- [`CLAUDE.md`](CLAUDE.md) — convenções do repositório.
