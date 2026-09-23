# Hospedar em produção

Como o Goodbot roda em produção e como subir o seu. Para rodar na sua máquina,
comece por [primeiros-passos.md](primeiros-passos.md); para operar o que já
está no ar (logs, incidentes, backup), use o [runbook](runbook.md).

## 1. O desenho

A hospedagem é dividida em três provedores, todos no plano gratuito, e só o
primeiro roda em Docker:

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

Nada disso é obrigatório. O bot roda em qualquer máquina x86 com Docker e 1 GB
de RAM, o painel em qualquer lugar que rode Next.js, e o banco pode ser
qualquer Postgres 16 ou 17. O que segue descreve o caminho que o repositório já
automatiza.

## 2. O que você precisa

- Uma aplicação no [Discord Developer Portal](https://discord.com/developers/applications)
  com bot, OAuth2 e os intents **Server Members**, **Message Content** e
  **Presence** ligados
  ([primeiros-passos.md §2](primeiros-passos.md#2-uma-aplicação-no-discord)).
- Uma VM x86_64. A `VM.Standard.E2.1.Micro` da Oracle (Always Free) é a que o
  projeto usa e mede: bot e Caddy ficam abaixo de 450 MB.
- Um projeto na Vercel com `apps/web` como Root Directory.
- Um projeto no Supabase (ou outro Postgres).
- Um domínio com cinco nomes: `bot.<dominio>` para a API e quatro para o
  painel (`<painel>`, `invite.<painel>`, `demo.<painel>` e `admin.<painel>`).

## 3. Deploy

Um `git push` na `main` dispara o `.github/workflows/deploy.yml`:

```
  push na main
       │
       ▼
  migrate  → pnpm db:migrate no Supabase (conexão direta)
       │
       ├──▶ painel → vercel build + deploy --prebuilt (produção)
       │
       └──▶ build  → imagem linux/amd64 em ghcr.io/<owner>/goodbot-bot
                 │
                 ▼
             deploy → scp de infra/ para a VM, depois
                      docker compose pull && up -d
```

A ordem existe por um motivo: o painel e o bot só sobem depois que o schema
novo está no banco. Quando a Vercel publicava pela integração git, em paralelo
com as migrations, o painel novo chegava a falar com o banco velho. Por isso o
`apps/web/vercel.json` desliga o deploy git na `main`; branch e PR continuam
ganhando preview pela integração normal.

O passo de `scp` leva o compose, o Caddyfile, o fail2ban e os scripts
(`deploy.sh`, `backup.sh`, `restore.sh`) a cada deploy, porque o
`docker compose up` da VM lê os arquivos do disco **dela**.

`deploy.yml` roda com `concurrency: deploy` e `cancel-in-progress: false`: um
deploy nunca é interrompido no meio. O `ci.yml` roda em todo push e PR (lint,
typecheck, testes com um Postgres de serviço, build).

**Num fork**, o job `migrate` só roda se o dono do repositório for
`DionathaGoulart`. Troque esse `if` pelo seu usuário para o deploy rodar.

## 4. Segredos e variáveis

| Onde                          | O quê                                                                                                                                                                |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub Secrets                | `DATABASE_URL` (direta, para as migrations), `SSH_HOST`, `SSH_USER`, `SSH_KEY`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`                                 |
| GitHub Variables              | `AUTH_URL` e `OWNER_DISCORD_ID`: não são segredo, e o deploy as escreve no `.env` da VM                                                                              |
| `.env` em `/opt/goodbot` (VM) | `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DATABASE_URL` (direta), `INTERNAL_API_TOKEN`, `BOT_DOMAIN`, `ACME_EMAIL`, `ALERT_WEBHOOK_URL`, `BACKUP_HOUR`                  |
| Variáveis da Vercel           | `DATABASE_URL` (pooler :6543), `AUTH_SECRET`, `AUTH_URL`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `INTERNAL_API_URL`, `INTERNAL_API_TOKEN`, `OWNER_DISCORD_ID` |

O GHCR usa o `GITHUB_TOKEN` do próprio job. Cada variável está explicada no
[`.env.example`](../.env.example). Para trocar o `INTERNAL_API_TOKEN` sem
derrubar nada, siga o [runbook](runbook.md#rotacionar-o-internal_api_token-sem-downtime).

## 5. Primeira vez na VM

```bash
ssh ubuntu@<ip>
git clone https://github.com/DionathaGoulart/Goodbot.git /tmp/goodbot && cd /tmp/goodbot
sudo bash infra/scripts/bootstrap-server.sh   # swap, iptables, docker, /opt/goodbot
$EDITOR /opt/goodbot/.env                       # preencher
/opt/goodbot/deploy.sh                          # sobe bot + caddy
```

O bootstrap é idempotente. O que ele **não** faz e continua manual:

- as Ingress Rules TCP 80/443 na Security List da VCN (Oracle);
- o DNS: `A` de `bot.<dominio>` para o IP da VM, e os quatro nomes do painel
  (`<painel>`, `invite.`, `demo.` e `admin.`) como domínios do projeto na
  Vercel;
- no Developer Portal, em OAuth2 > Redirects:
  `https://<painel>/api/auth/callback/discord`,
  `https://invite.<painel>/api/invite/callback` e
  `https://demo.<painel>/api/invite/callback`.

A imagem padrão do Compose é `ghcr.io/dionathagoulart/goodbot-bot`, que é
pública. Para usar a imagem publicada pelo seu fork, ponha
`BOT_IMAGE=ghcr.io/<seu-usuario>/goodbot-bot` no `.env` da VM. Se o seu pacote
no GHCR for privado, a VM precisa de `docker login ghcr.io` antes do primeiro
pull.

## 6. Rollback

As imagens ficam no GHCR com a tag `sha-<commit>` além de `latest`:

```bash
ssh ubuntu@<ip> '/opt/goodbot/deploy.sh sha-1a2b3c4'
```

O painel volta pelo botão _Promote_ de um deployment anterior na Vercel. As
migrations não voltam sozinhas: um rollback para antes de uma migration só é
seguro se ela foi aditiva (coluna ou tabela nova).

## 7. Conferir depois do deploy

```bash
ssh ubuntu@<ip> 'cd /opt/goodbot && docker compose ps && docker compose logs --tail 20 bot'
curl -s https://bot.<dominio>/health                      # {"ok":true}
curl -s -o /dev/null -w '%{http_code}\n' \
  -H 'Authorization: Bearer errado' \
  https://bot.<dominio>/guilds/$GUILD_ID/roles            # 401
curl -sI https://<painel> | head -5                         # painel na Vercel
```

## 8. A stack de produção na sua máquina

O lado da Oracle dá para reproduzir localmente:

```bash
pnpm docker:build                       # imagem linux/amd64 do bot (goodbot-bot:local)
BOT_IMAGE=goodbot-bot TAG=local BOT_DOMAIN=localhost pnpm docker:up
curl -k https://localhost/health        # {"ok":true}
docker stats --no-stream                # bot + caddy < 450 MB
pnpm docker:down
```

Com `BOT_DOMAIN=localhost` o Caddy emite um certificado interno, daí o `-k` do
curl. Em produção `BOT_DOMAIN=bot.<dominio>` e o certificado é Let's Encrypt,
automático. Qualquer `Host` diferente do configurado recebe 404.

Para exercitar o painel contra esse Caddy (build de produção, fora do Docker):

```bash
pnpm --filter @goodbot/web build
NODE_TLS_REJECT_UNAUTHORIZED=0 INTERNAL_API_URL=https://localhost \
  pnpm --filter @goodbot/web start
```

`NODE_TLS_REJECT_UNAUTHORIZED=0` existe **só** para aceitar o certificado
interno do teste local; na Vercel o certificado é público e a variável não
entra. As migrations nunca rodam no boot do bot: são um passo da CI.
