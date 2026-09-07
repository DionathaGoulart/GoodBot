# CoBot

[![CI](https://github.com/DionathaGoulart/Bot/actions/workflows/ci.yml/badge.svg)](https://github.com/DionathaGoulart/Bot/actions/workflows/ci.yml)
[![Deploy](https://github.com/DionathaGoulart/Bot/actions/workflows/deploy.yml/badge.svg)](https://github.com/DionathaGoulart/Bot/actions/workflows/deploy.yml)

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
pnpm docker:build                       # imagem linux/amd64 do bot (cobot-bot:local)
BOT_IMAGE=cobot-bot TAG=local BOT_DOMAIN=localhost pnpm docker:up
curl -k https://localhost/health        # {"ok":true}
docker stats --no-stream                # bot + caddy < 450 MB
pnpm docker:down
```

Sem `BOT_IMAGE`/`TAG` o Compose usa a imagem publicada no GHCR
(`ghcr.io/dionathagoulart/cobot-bot:latest`) — que é o que a VM faz.

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

## Deploy

Dois pipelines independentes disparam no mesmo `git push origin main`:

```
  push na main
       ├──▶ GitHub Actions (.github/workflows/deploy.yml)
       │      1. migrate  → pnpm db:migrate no Supabase (conexão direta)
       │      2. build    → imagem linux/amd64 no ghcr.io/<owner>/cobot-bot
       │      3. deploy   → ssh na VM: docker compose pull && up -d
       │
       └──▶ Vercel (integração git, sem Action)
              build do apps/web e publicação em cobot.<dominio>
```

`ci.yml` roda em todo push e todo PR (lint, typecheck, testes com um Postgres
de serviço, build) — é ele que reprova um PR com erro de tipo. `deploy.yml` só
roda na `main`, com `concurrency: deploy` e `cancel-in-progress: false`: um
deploy nunca é interrompido no meio.

### Segredos por provedor

| Onde                        | Segredo                                                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| GitHub Secrets              | `DATABASE_URL` (direta, para as migrations), `SSH_HOST`, `SSH_USER`, `SSH_KEY`; o GHCR usa o `GITHUB_TOKEN`                                |
| `.env` em `/opt/cobot` (VM) | `DISCORD_TOKEN`, `GUILD_ID`, `DATABASE_URL` (direta), `INTERNAL_API_TOKEN`, `BOT_DOMAIN`, `ACME_EMAIL`                                     |
| Variáveis da Vercel         | `DATABASE_URL` (pooler :6543), `AUTH_SECRET`, `AUTH_URL`, `DISCORD_CLIENT_ID/SECRET`, `INTERNAL_API_URL`, `INTERNAL_API_TOKEN`, `GUILD_ID` |

O `INTERNAL_API_TOKEN` está na VM e na Vercel; rotacionar significa trocar nos
dois de uma vez.

### Primeira vez na VM

```bash
ssh ubuntu@<ip>
git clone <repo> /tmp/cobot && cd /tmp/cobot
sudo bash infra/scripts/bootstrap-server.sh   # swap, iptables, docker, /opt/cobot
$EDITOR /opt/cobot/.env                       # preencher
/opt/cobot/deploy.sh                          # sobe bot + caddy
```

O bootstrap é idempotente. O que ele **não** faz e continua manual: as Ingress
Rules TCP 80/443 na Security List da VCN, o DNS (`A` de `bot.<dominio>` para o
IP da VM, `CNAME` do painel para a Vercel), o redirect
`https://cobot.<dominio>/api/auth/callback/discord` no Developer Portal e o
`docker login ghcr.io` caso o pacote seja privado.

### Rollback

As imagens ficam no GHCR com tag `sha-<commit>` além de `latest`:

```bash
ssh ubuntu@<ip> '/opt/cobot/deploy.sh sha-1a2b3c4'
```

O painel volta pelo botão _Promote_ de um deployment anterior na Vercel.

### Verificação pós-deploy

```bash
ssh ubuntu@<ip> 'cd /opt/cobot && docker compose ps && docker compose logs --tail 20 bot'
curl -s https://bot.<dominio>/health                      # {"ok":true}
curl -s -o /dev/null -w '%{http_code}\n' \
  -H 'Authorization: Bearer errado' \
  https://bot.<dominio>/guilds/$GUILD_ID/roles            # 401
curl -sI https://cobot.<dominio> | head -5                # painel na Vercel
```

## Documentação

- [`.harness/prd.md`](.harness/prd.md) — requisitos, modelo de dados, decisões.
- [`.harness/styleguide.md`](.harness/styleguide.md) — guia visual do painel.
- [`.harness/plan.md`](.harness/plan.md) — plano de execução por etapas.
- [`CLAUDE.md`](CLAUDE.md) — convenções do repositório.
