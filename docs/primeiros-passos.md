# Primeiros passos

Do zero até o bot respondendo e o painel abrindo na sua máquina.

## 1. Requisitos

| Ferramenta | Versão | Como                       |
| ---------- | ------ | -------------------------- |
| Node       | 22 LTS | `nvm use` (há um `.nvmrc`) |
| pnpm       | 9      | `corepack enable`          |
| Docker     | atual  | só para o Postgres local   |

Node 23+ **não** serve: o `package.json` declara `engines.node: >=22 <23` e o
pnpm recusa instalar fora disso.

## 2. Uma aplicação no Discord

No [Developer Portal](https://discord.com/developers/applications):

1. **New Application** e dê um nome.
2. **Bot > Reset Token** e guarde o token → `DISCORD_TOKEN`.
3. **Bot**: ligue os três _Privileged Gateway Intents_ (Presence, Server
   Members, Message Content). Sem _Message Content_ o automod não vê nada.
4. **General Information**: copie o Application ID → `DISCORD_CLIENT_ID`.
5. **OAuth2**: copie o Client Secret → `DISCORD_CLIENT_SECRET`.
6. **OAuth2 > Redirects**: adicione
   `http://localhost:3000/api/auth/callback/discord`.
7. **OAuth2 > URL Generator**: escopos `bot` e `applications.commands`, as
   permissões do PRD §10, e use a URL para convidar o bot ao seu servidor de
   testes.

Ligue o **Modo desenvolvedor** no Discord (Configurações > Avançado) para
conseguir copiar IDs. Botão direito no servidor > **Copiar ID do servidor** →
`GUILD_ID`.

## 3. Variáveis

```bash
cp .env.example .env
```

O mínimo para subir:

```bash
DISCORD_TOKEN=...
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
GUILD_ID=...
DATABASE_URL=postgres://goodbot:goodbot@localhost:5432/goodbot
INTERNAL_API_TOKEN=$(openssl rand -hex 32)
AUTH_SECRET=$(openssl rand -base64 32)
```

O resto do `.env.example` só entra em produção e está comentado lá.

## 4. Subir

```bash
docker compose -f infra/docker-compose.dev.yml up -d postgres
pnpm install
pnpm --filter @goodbot/db db:migrate
pnpm dev
```

`pnpm dev` sobe os dois em paralelo:

- bot em `:3001` (a API interna)
- painel em `http://localhost:3000`

Entre no painel com a mesma conta Discord que é dona do servidor de testes.

## 5. Conferir que está de pé

```bash
curl -s localhost:3001/health                     # {"ok":true, ...}
curl -s -o /dev/null -w '%{http_code}\n' \
  localhost:3001/guilds/$GUILD_ID/roles           # 401 (sem token, correto)
curl -s -H "Authorization: Bearer $INTERNAL_API_TOKEN" \
  localhost:3001/guilds/$GUILD_ID/roles | head    # a lista de cargos
```

No Discord, `/ping` deve responder.

## 6. Validação

Antes de considerar qualquer mudança pronta:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

## 7. Problemas comuns

**`ERR_PNPM_UNSUPPORTED_ENGINE`** — Node fora da faixa 22.x. `nvm use`.

**Comandos não aparecem no Discord** — são registrados como _guild commands_
do `GUILD_ID`. Confira se o bot está naquele servidor e se o `GUILD_ID` está
certo. Guild commands propagam na hora; se não apareceram, o registro falhou —
veja o log do boot.

**Automod não reage a nada** — falta o intent _Message Content_.

**Painel abre mas as telas de servidor dão erro** — o painel não fala com o
Discord, e sim com a API do bot. Confira `INTERNAL_API_URL` e se o
`INTERNAL_API_TOKEN` é **o mesmo** dos dois lados.

**`connect ECONNREFUSED ...:5432`** — o Postgres do Docker não subiu.
`docker compose -f infra/docker-compose.dev.yml ps`.

## 8. Depois daqui

- [`.harness/architecture.md`](../.harness/architecture.md) — como o código é
  organizado e onde mexer para cada tipo de tarefa.
- [`guild-como-codigo.md`](guild-como-codigo.md) — configurar o servidor por
  arquivo em vez de clicar no painel.
- [`contribuindo.md`](contribuindo.md) — convenções e checklist de PR.
