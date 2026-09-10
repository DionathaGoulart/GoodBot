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
6. **OAuth2 > Redirects**: adicione as três. A primeira é o login do painel;
   as outras duas são os fluxos de convite (§7.2), e o Discord exige que cada
   uma esteja registrada literalmente:

   ```
   http://localhost:3000/api/auth/callback/discord
   http://invite.localhost:3000/api/invite/callback
   http://demo.localhost:3000/api/invite/callback
   ```

7. **Installation > Install Link: `None`.** Senão o Discord oferece o botão
   "Add App" do perfil do bot, que instala **sem** passar pelos nossos links —
   e esse servidor entraria no registro sem classificação nenhuma.
8. **OAuth2 > URL Generator**: escopos `bot` e `applications.commands`, as
   permissões do PRD §10, e use a URL para convidar o bot ao seu servidor de
   testes. (Em produção quem monta essa URL é o painel, em `invite.` e
   `demo.`; o gerador serve para o servidor de testes.)

Ligue o **Modo desenvolvedor** no Discord (Configurações > Avançado) para
conseguir copiar IDs. Botão direito no servidor > **Copiar ID do servidor** →
`GUILD_IDS`. Mais de um servidor? Separe por vírgula:
`GUILD_IDS=111...,222...`.

`GUILD_IDS` é a **semente** do registro de servidores (`guild_registry`): no
boot, todo ID que ainda não tem linha entra como `approved`. Daí em diante quem
decide o que o bot atende é a tabela.

## 3. Variáveis

```bash
cp .env.example .env
```

O mínimo para subir:

```bash
DISCORD_TOKEN=...
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
GUILD_IDS=...
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

**Comandos não aparecem no Discord** — são registrados como _guild commands_,
uma guild por vez, e só nas que o bot **atende**. Confira se o bot está naquele
servidor e se a linha dele em `guild_registry` está `approved` (ou `demo` no
prazo): o log do boot diz `guild não atendida; o bot fica calado nela` quando
não está. Guild commands propagam na hora; se não apareceram e o status está
certo, o registro falhou — veja o log do boot.

**Automod não reage a nada** — falta o intent _Message Content_.

**Painel abre mas as telas de servidor dão erro** — o painel não fala com o
Discord, e sim com a API do bot. Confira `INTERNAL_API_URL` e se o
`INTERNAL_API_TOKEN` é **o mesmo** dos dois lados.

**`connect ECONNREFUSED ...:5432`** — o Postgres do Docker não subiu.
`docker compose -f infra/docker-compose.dev.yml ps`.

## 7.1 Adicionar um segundo servidor

O bot atende vários servidores. A ordem importa: **convide primeiro, configure
depois**, senão ele fica online e calado lá.

1. **Convide o bot** pelo OAuth2 URL Generator (escopos `bot` e
   `applications.commands`, permissões do PRD §10).
2. **Ponha o cargo do bot no topo** da lista de cargos do servidor novo. Regra
   do Discord: cargo só mexe em cargo abaixo dele.
3. **Acrescente o ID** ao `GUILD_IDS` do `.env` da VM
   (`/opt/goodbot/.env`), separado por vírgula. O painel não precisa da
   variável: ele lê o registro no banco.

   Se hoje está como `GUILD_ID`, pode trocar o nome ou deixar: `GUILD_IDS`
   ganha quando os dois existem.

4. **Reinicie o bot.** No boot, o ID novo vira uma linha `approved` no
   registro, e o `ready` prepara a guild: cache de membros, config e registro
   dos comandos.

> A semeadura só vale para servidor **sem linha** no registro. Se o bot já foi
> convidado antes (a linha nasce `pending`), acrescentar o ID não aprova nada —
> até o painel admin existir, aprovar é um `update` na tabela:
>
> ```sql
> update guild_registry
>    set status = 'approved', approved_at = now(), updated_at = now()
>  where guild_id = '<id>';
> ```
>
> O bot relê o registro a cada minuto; não precisa reiniciar.

O que muda no painel: a barra lateral passa a mostrar o nome real de cada
servidor e a oferecer a troca. Seu nível de permissão é resolvido **por
servidor** — ser dono de um não dá nada no outro.

### O que conferir depois

```bash
curl -s -H "Authorization: Bearer $INTERNAL_API_TOKEN" \
  https://bot.<dominio>/health
```

O bloco `guilds` deve mostrar `cached` igual a `expected`. Se `cached` for
menor, o bot não está em algum servidor da lista — o log do boot diz qual.

### Quanto a VM aguenta

O gargalo é o cache de membros: o boot carrega a lista completa de cada guild e
a RAM cresce com a **soma** dos membros. O container tem `mem_limit: 384m`, o
que dá ordem de 10⁵ membros somados. O consumo real está no `rssBytes` do
`/health` — vale olhar depois de acrescentar um servidor grande.

Se um dia apertar, a saída não é VM maior: é pôr teto no `GuildMemberManager`
(`apps/bot/src/client.ts`) e buscar membro sob demanda.

## 7.2 Os dois links de convite

Em produção o bot não é convidado pela URL crua do Discord: ela não conta ao
bot por onde a pessoa veio, e é justamente isso que decide se o servidor entra
na fila ou já sai atendendo. Por isso existem **dois links nossos**, cada um no
seu subdomínio:

| Link                               | Status na entrada | O bot atende?         |
| ---------------------------------- | ----------------- | --------------------- |
| `https://invite.goodbot.<domínio>` | `pending`         | não, espera aprovação |
| `https://demo.goodbot.<domínio>`   | `demo`            | sim, por 1 hora       |

O caminho é sempre o mesmo: a pessoa abre o link, lê o que vai acontecer e
clica; nós assinamos um `state` (HMAC do `AUTH_SECRET`, válido por 15 minutos)
e mandamos ao OAuth do Discord com o `redirect_uri` de volta para o **mesmo**
subdomínio. Na volta, trocamos o `code` com o Discord — é essa troca, e não o
`guild_id` da URL, que prova que a instalação aconteceu — e gravamos a linha em
`guild_registry`.

Três regras que caem de graça disso, porque uma linha que já existe nunca tem o
status sobrescrito:

- servidor **bloqueado** continua bloqueado, use quem usar o link;
- servidor **já aprovado** não volta para a fila nem vira demo com prazo;
- a **demo não se renova**: quem já usou a sua espera aprovação como qualquer
  um, senão dava para ficar renovando de hora em hora.

### Testar na sua máquina

Os subdomínios de `localhost` resolvem para 127.0.0.1 nos navegadores atuais,
então não é preciso mexer no `hosts`:

```
http://invite.localhost:3000
http://demo.localhost:3000
```

Com o `pnpm dev` rodando, abra um dos dois. Se cair no painel em vez da tela de
convite, o `Host` chegou sem o rótulo — confira a URL. As duas URLs de callback
precisam estar em **OAuth2 > Redirects** (§2).

O `http://localhost:3000/convite` mostra os dois links, o que é útil para
conferir de onde eles apontam sem decorar os subdomínios.

## 8. Depois daqui

- [`.harness/architecture.md`](../.harness/architecture.md) — como o código é
  organizado e onde mexer para cada tipo de tarefa.
- [`guild-como-codigo.md`](guild-como-codigo.md) — configurar o servidor por
  arquivo em vez de clicar no painel.
- [`contribuindo.md`](contribuindo.md) — convenções e checklist de PR.
