# CoBot

Bot de moderação para Discord (discord.js v14) + painel web (Next.js) para
configurar e administrar um servidor. Monorepo pnpm em TypeScript, com a
hospedagem dividida em três: o **bot** numa VM x86 da Oracle (Always Free) via
Docker Compose, o **painel** na Vercel e o **Postgres** no Supabase.

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

## Rodar em produção localmente

O desenho de produção tem três provedores, e só o primeiro roda em Docker:

```
                     ┌─ Vercel ─────────────┐
   navegador ───────▶│  painel (Next.js)    │
                     └──────────┬───────────┘
                                │ HTTPS + Bearer (INTERNAL_API_TOKEN)
                     ┌─ Oracle E2.1.Micro ──▼───────────────┐
                     │  caddy :80/:443  ──▶  bot :3001      │
                     │  (TLS automático)     (sem porta     │
                     │                        publicada)    │
                     └──────────┬───────────────────────────┘
        Discord ◀───────────────┤ gateway + REST
                                │
                     ┌─ Supabase ▼──────────┐
                     │  Postgres (TLS)      │   ← o painel usa o pooler :6543,
                     └──────────────────────┘     o bot a conexão direta :5432
```

O que dá para reproduzir na máquina de desenvolvimento é o lado da Oracle:

```bash
pnpm docker:build                       # imagem linux/amd64 do bot
BOT_DOMAIN=localhost pnpm docker:up     # bot + caddy (certificado interno)
curl -k https://localhost/health        # {"ok":true}
docker stats --no-stream                # bot + caddy < 450 MB
pnpm docker:down
```

Com `BOT_DOMAIN=localhost` o Caddy emite um certificado interno — daí o `-k`
do curl. Em produção `BOT_DOMAIN=bot.<dominio>` e o certificado é Let's
Encrypt, automático. Qualquer `Host` diferente do configurado recebe 404.

Para exercitar o painel contra esse Caddy (build de produção, fora do Docker):

```bash
pnpm --filter @cobot/web build
NODE_TLS_REJECT_UNAUTHORIZED=0 INTERNAL_API_URL=https://localhost \
  pnpm --filter @cobot/web start
```

`NODE_TLS_REJECT_UNAUTHORIZED=0` existe **só** para aceitar o certificado
interno do teste local; na Vercel o certificado é público e a variável não
entra. As migrations nunca rodam no boot do bot: são um passo da CI
(`pnpm db:migrate` com a `DATABASE_URL` do Supabase, que traz
`?sslmode=require`).

### Os três cofres de segredo

| Onde                | Para quê                       | Contém                                                                           |
| ------------------- | ------------------------------ | -------------------------------------------------------------------------------- |
| `.env` na VM        | bot + caddy (`env_file`)       | `DISCORD_TOKEN`, `DATABASE_URL` (direta), `INTERNAL_API_TOKEN`, `BOT_DOMAIN`     |
| GitHub Secrets      | CI (build, migrations, deploy) | `DATABASE_URL`, chave SSH, credenciais do GHCR                                   |
| Variáveis da Vercel | painel                         | `AUTH_SECRET`, `DATABASE_URL` (pooler), `INTERNAL_API_URL`, `INTERNAL_API_TOKEN` |

O `INTERNAL_API_TOKEN` vive nos três e é rotacionado nos três de uma vez.

## Documentação

- [`.harness/prd.md`](.harness/prd.md) — requisitos, modelo de dados, decisões.
- [`.harness/styleguide.md`](.harness/styleguide.md) — guia visual do painel.
- [`.harness/plan.md`](.harness/plan.md) — plano de execução por etapas.
- [`CLAUDE.md`](CLAUDE.md) — convenções do repositório.
