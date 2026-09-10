# Goodbot

[![CI](https://github.com/DionathaGoulart/Goodbot/actions/workflows/ci.yml/badge.svg)](https://github.com/DionathaGoulart/Goodbot/actions/workflows/ci.yml)
[![Deploy](https://github.com/DionathaGoulart/Goodbot/actions/workflows/deploy.yml/badge.svg)](https://github.com/DionathaGoulart/Goodbot/actions/workflows/deploy.yml)

Bot de moderação para Discord (discord.js v14) + painel web (Next.js) para
configurar e administrar um servidor. Monorepo pnpm em TypeScript, com a
hospedagem dividida em três: o **bot** numa VM x86 da Oracle (Always Free) via
Docker Compose, o **painel** na Vercel e o **Postgres** no Supabase.

## Estrutura

```
apps/bot                bot Discord + API interna (Hono)
apps/web                painel Next.js (App Router, Tailwind, shadcn/ui, Auth.js)
packages/db             Drizzle: schema e migrations
packages/shared         Zod: schemas, tipos e constantes compartilhados
packages/guild-config   guild como código: aplica um guild.yaml no servidor
infra/                  docker-compose, Caddy, Dockerfiles, deploy, guild.yaml
.harness/               PRD, arquitetura e styleguide (fonte de verdade)
docs/                   guias de operação e de uso
```

Para entender o código, comece por
[`.harness/architecture.md`](.harness/architecture.md): o que existe, onde mora
e por quê.

## Módulos

Cada módulo liga e desliga por servidor, tem uma página no painel e um schema
Zod próprio em `packages/shared/src/config/`:

| Módulo             | O que faz                                                        |
| ------------------ | ---------------------------------------------------------------- |
| **Moderação**      | ban, kick, timeout, warn, notas e casos numerados com mod-log    |
| **Automod**        | spam, links, caps, palavras, menções e modo anti-raid            |
| **Logs**           | mensagens, membros, servidor e voz em canais separados           |
| **Boas-vindas**    | mensagem de entrada, de saída e DM, por template                 |
| **Autorole**       | cargos na entrada e verificação por botão                        |
| **Reaction roles** | painéis de cargo por botão, menu ou reação                       |
| **Tickets**        | tipos, painel de abertura, transcript e fechamento               |
| **Tags**           | respostas salvas com autocomplete                                |
| **Utilidades**     | clear, purge, lock, slowmode, lembretes, enquetes e info         |
| **Estatísticas**   | mensagens, entradas/saídas, voz e casos agregados por hora e dia |
| **Redes sociais**  | avisa quando o canal do YouTube publica vídeo, short ou live     |

O módulo de redes sociais funciona por polling, nunca por webhook de entrada, e
não pede credencial nenhuma: vídeo, short e live saem de páginas públicas do
próprio YouTube (feed RSS, `watch?v=` e `/channel/<id>/live`). O intervalo do
laço fica na config do módulo, no painel — uma passada percorre todas as contas
ligadas, e cada conta são duas requisições ao YouTube.

### Cadastrar um canal do YouTube

Pelo painel, em **Redes sociais → `ADICIONAR CANAL`**: cole no campo
"Canal do YouTube" a URL da barra de endereços
(`https://www.youtube.com/@LofiGirl`), o `@handle` ou o ID `UC…` e clique
`BUSCAR`. O bot resolve os três formatos, e o cartão com avatar e nome aparece
antes de salvar — se o canal não existir, o erro sai no próprio campo. Depois
escolha o canal do Discord, quais tipos anunciar (vídeos, shorts, lives), o
cargo a mencionar (opcional) e o template.

Pelo Discord é `/social add`, que aceita o mesmo campo livre e confirma com o
nome e o avatar do canal. `/social list` mostra as contas e o estado de cada
uma; `/social test` manda um anúncio de exemplo.

A primeira passada de uma conta nova **não anuncia nada**: ela só marca o que
já estava no feed e passa a avisar do próximo post em diante.

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

## Configurar um servidor por arquivo

Além do painel, a estrutura de um servidor (cargos, categorias, canais e
permissões) pode ser descrita num arquivo e aplicada de uma vez:

```bash
cp -r infra/discord/exemplo infra/discord/meu-servidor
$EDITOR infra/discord/meu-servidor/guild.yaml   # a estrutura desejada
$EDITOR infra/discord/meu-servidor/.env         # GUILD_ID, ACTOR_ID, token

pnpm guild plan  --server meu-servidor          # mostra o que mudaria
pnpm guild apply --server meu-servidor          # executa após confirmar
```

O `guild.yaml` não contém ID nenhum — tudo é por nome, e os IDs são resolvidos
contra o servidor na hora. Por isso ele pode ser versionado num repositório
público e o mesmo arquivo serve para mais de um servidor. Os segredos ficam no
`.env` ao lado, que é gitignored.

O apply é idempotente: rodar duas vezes seguidas não faz nada na segunda. E ele
**nunca apaga** sem `--allow-delete`, porque apagar canal leva as mensagens
junto.

Detalhes em [`docs/guild-como-codigo.md`](docs/guild-como-codigo.md).

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
pnpm docker:build                       # imagem linux/amd64 do bot (goodbot-bot:local)
BOT_IMAGE=goodbot-bot TAG=local BOT_DOMAIN=localhost pnpm docker:up
curl -k https://localhost/health        # {"ok":true}
docker stats --no-stream                # bot + caddy < 450 MB
pnpm docker:down
```

Sem `BOT_IMAGE`/`TAG` o Compose usa a imagem publicada no GHCR
(`ghcr.io/dionathagoulart/goodbot-bot:latest`) — que é o que a VM faz.

Com `BOT_DOMAIN=localhost` o Caddy emite um certificado interno — daí o `-k`
do curl. Em produção `BOT_DOMAIN=bot.<dominio>` e o certificado é Let's
Encrypt, automático. Qualquer `Host` diferente do configurado recebe 404.

Para exercitar o painel contra esse Caddy (build de produção, fora do Docker):

```bash
pnpm --filter @goodbot/web build
NODE_TLS_REJECT_UNAUTHORIZED=0 INTERNAL_API_URL=https://localhost \
  pnpm --filter @goodbot/web start
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
       │      2. build    → imagem linux/amd64 no ghcr.io/<owner>/goodbot-bot
       │      3. deploy   → ssh na VM: docker compose pull && up -d
       │
       └──▶ Vercel (integração git, sem Action)
              build do apps/web e publicação em goodbot.<dominio>
```

`ci.yml` roda em todo push e todo PR (lint, typecheck, testes com um Postgres
de serviço, build) — é ele que reprova um PR com erro de tipo. `deploy.yml` só
roda na `main`, com `concurrency: deploy` e `cancel-in-progress: false`: um
deploy nunca é interrompido no meio.

### Segredos por provedor

| Onde                          | Segredo                                                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| GitHub Secrets                | `DATABASE_URL` (direta, para as migrations), `SSH_HOST`, `SSH_USER`, `SSH_KEY`; o GHCR usa o `GITHUB_TOKEN`                                |
| `.env` em `/opt/goodbot` (VM) | `DISCORD_TOKEN`, `GUILD_ID`, `DATABASE_URL` (direta), `INTERNAL_API_TOKEN`, `BOT_DOMAIN`, `ACME_EMAIL`                                     |
| Variáveis da Vercel           | `DATABASE_URL` (pooler :6543), `AUTH_SECRET`, `AUTH_URL`, `DISCORD_CLIENT_ID/SECRET`, `INTERNAL_API_URL`, `INTERNAL_API_TOKEN`, `GUILD_ID` |

O `INTERNAL_API_TOKEN` está na VM e na Vercel; rotacionar significa trocar nos
dois de uma vez.

### Primeira vez na VM

```bash
ssh ubuntu@<ip>
git clone <repo> /tmp/goodbot && cd /tmp/goodbot
sudo bash infra/scripts/bootstrap-server.sh   # swap, iptables, docker, /opt/goodbot
$EDITOR /opt/goodbot/.env                       # preencher
/opt/goodbot/deploy.sh                          # sobe bot + caddy
```

O bootstrap é idempotente. O que ele **não** faz e continua manual: as Ingress
Rules TCP 80/443 na Security List da VCN, o DNS (`A` de `bot.<dominio>` para o
IP da VM, `CNAME` do painel para a Vercel), o redirect
`https://goodbot.<dominio>/api/auth/callback/discord` no Developer Portal e o
`docker login ghcr.io` caso o pacote seja privado.

### Rollback

As imagens ficam no GHCR com tag `sha-<commit>` além de `latest`:

```bash
ssh ubuntu@<ip> '/opt/goodbot/deploy.sh sha-1a2b3c4'
```

O painel volta pelo botão _Promote_ de um deployment anterior na Vercel.

### Verificação pós-deploy

```bash
ssh ubuntu@<ip> 'cd /opt/goodbot && docker compose ps && docker compose logs --tail 20 bot'
curl -s https://bot.<dominio>/health                      # {"ok":true}
curl -s -o /dev/null -w '%{http_code}\n' \
  -H 'Authorization: Bearer errado' \
  https://bot.<dominio>/guilds/$GUILD_ID/roles            # 401
curl -sI https://goodbot.<dominio> | head -5                # painel na Vercel
```

## Documentação

Comece por aqui:

- [`.harness/architecture.md`](.harness/architecture.md) — **o mapa do código**:
  camadas, fluxos de ponta a ponta, invariantes e onde mexer para cada tarefa.
- [`.harness/prd.md`](.harness/prd.md) — requisitos, modelo de dados, decisões.
- [`.harness/styleguide.md`](.harness/styleguide.md) — guia visual do painel.
- [`CLAUDE.md`](CLAUDE.md) — convenções do repositório.

Guias em [`docs/`](docs/):

| Guia                                                | Para quê                                 |
| --------------------------------------------------- | ---------------------------------------- |
| [`primeiros-passos.md`](docs/primeiros-passos.md)   | subir o projeto do zero na sua máquina   |
| [`guild-como-codigo.md`](docs/guild-como-codigo.md) | configurar um servidor por arquivo       |
| [`api-interna.md`](docs/api-interna.md)             | falar com a API do bot direto            |
| [`modulos.md`](docs/modulos.md)                     | o que cada módulo faz e como configurar  |
| [`banco-de-dados.md`](docs/banco-de-dados.md)       | schema, migrations e repositories        |
| [`contribuindo.md`](docs/contribuindo.md)           | convenções, commits e checklist de PR    |
| [`runbook.md`](docs/runbook.md)                     | operação: incidentes, rollback, plantão  |
| [`migracao-nome.md`](docs/migracao-nome.md)         | passos externos da troca CoBot → Goodbot |
