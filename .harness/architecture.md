# Goodbot — Arquitetura

Documento de orientação: o que existe, onde mora e por quê. Quem chega aqui
(pessoa ou IA) deve conseguir situar-se sem ler o repositório inteiro.

Para **requisitos** (o que o produto tem de fazer) leia `prd.md`. Para o
**visual do painel** leia `styleguide.md`. Este arquivo é sobre o **código**.

---

## 1. Em uma frase

Bot de moderação para Discord com painel web, num monorepo pnpm em TypeScript,
onde o painel **não fala com o Discord**: ele fala com uma API HTTP exposta
pelo próprio bot, que é o único processo com uma sessão de gateway aberta.

## 2. Mapa de 30 segundos

```
   ┌── navegador ───────────────────────────────────────────────┐
   │  painel Next.js (Vercel)                                   │
   │  Server Components + Server Actions                        │
   └───────────────┬────────────────────────────────────────────┘
                   │ HTTPS + Authorization: Bearer INTERNAL_API_TOKEN
                   │ (o painel nunca tem token do Discord)
   ┌───────────────▼────────────────────────────────────────────┐
   │  bot (VM Oracle, Docker + Caddy)                           │
   │                                                            │
   │   API Hono ──┐                       ┌── gateway discord.js│
   │              ├─▶ services ◀──────────┤   (eventos)         │
   │   CLI guild ─┘        │              └── REST discord.js   │
   │                       │                                    │
   └───────────────────────┼────────────────────────────────────┘
                           │ Drizzle
                   ┌───────▼────────┐
                   │ Postgres       │  (Supabase em produção,
                   │ 33 tabelas     │   Docker local em dev)
                   └────────────────┘
```

A consequência mais importante desse desenho: **toda escrita no Discord passa
pelo processo do bot**. O painel e o CLI de guild são clientes da mesma API, e
por isso herdam de graça as mesmas checagens de permissão, hierarquia,
validação Zod e rate limit.

## 3. Os pacotes e a regra de dependência

| Pacote                  | Papel                                                          |
| ----------------------- | -------------------------------------------------------------- |
| `apps/bot`              | discord.js v14, handler próprio, API interna Hono, jobs         |
| `apps/web`              | Next.js App Router, Tailwind, shadcn/ui, Auth.js (Discord)      |
| `packages/db`           | Drizzle: schema, migrations e repositories                      |
| `packages/shared`       | Zod: contratos entre todo mundo. Não depende de ninguém         |
| `packages/guild-config` | Guild como código: varre, analisa e aplica pela API do bot      |

A regra que mantém isso saudável: **as setas apontam para `shared`, nunca para
fora dele.**

```
  bot ─────┐
  web ─────┼──▶ shared        db ──▶ shared
  guild-config ─┘             bot ──▶ db
```

`shared` não importa `db`, `bot` nem `web`. Se um schema Zod precisar de algo
do banco, o dado vira tipo puro em `shared` e o `db` se adapta — não o
contrário. É o que permite o painel (que roda na Vercel, sem acesso ao gateway)
importar exatamente os mesmos schemas que o bot usa para validar.

---

## 4. `apps/bot`

### 4.1 Boot

`src/index.ts` é uma função `main()` que faz a composição manual de tudo — não
há container de injeção de dependência. A ordem importa:

1. `createDb(env.DATABASE_URL)` e `createClient()` (o client discord.js)
2. Instancia os **services** passando `{ db, client, config, ... }` a cada um
3. `loadCommands` / `loadEvents` (`src/lib/loader.ts`) registram o handler
4. `createApiServer(...)` sobe o Hono
5. Os **jobs** entram no `Scheduler`
6. `client.login()`

Antes do `login`, o `GUILD_IDS` é semeado no registro (`RegistryService.seed`)
e o espelho em memória é carregado: quando o primeiro evento chegar, o bot já
sabe quem atende. No `ready`, cada guild **atendida pelo registro** é preparada
por vez (`lib/guild-setup.ts`: upsert, config, guild commands — o cache de
membros **não** é preenchido no boot: ele tem teto por
guild e se enche pelos eventos, porque a RAM crescia com a soma dos membros de
todos os servidores). Guild ausente vira log de erro e não impede as outras. Guild em que
o bot está mas não atende ganha linha `pending` e fica calada; bloqueada, ele
sai. Os dois recursos do processo (LRU de mensagens, intervalo de flush das
stats) recebem o maior cache e o menor intervalo entre as guilds — quem resolve
esse conflito é o `ProcessTuner`, porque desde o registro uma guild pode entrar
depois do boot.

O `BotContext` (`src/lib/command.ts`) é o objeto que carrega os services e é
entregue a todo comando e evento. Quem precisa de uma capacidade nova a recebe
por aí, e não importando o módulo direto.

### 4.2 Camadas

```
src/
  index.ts        composição e boot
  client.ts       o Client do discord.js, com os intents
  env.ts          Zod sobre process.env — falha no boot, não em runtime
  logger.ts       pino
  metrics.ts      contadores em memória, expostos em /metrics

  commands/       um arquivo por slash command, agrupados por módulo
    moderation/   ban, kick, timeout, warn, note, case, history, purge...
    automod/      automod, raid
    community/    tag, ticket, reactionrole, welcome, verify, social, squad
    utilities/    clear, lock, slowmode, poll, remind, info, stats, say

  events/         handlers de evento do gateway, agrupados por assunto
    automod/      messages, members
    logs/         messages, members, server, voice
    community/    members, reaction-roles, squads-voice
    stats/        contagem

  interactions/   botões, selects e modais, roteados pelo prefixo do
                  `custom_id` (tickets, squads...)
  automod/        o motor: engine.ts + rules/{spam,links,caps,words,mentions}
  services/       a lógica de verdade; ver abaixo
  jobs/           tarefas periódicas: retention, social, stats-rollup,
                  demo-expiry (avisa quem convidou, se despede e sai quando a
                  demo vence), pending-expiry (recusa o convite parado uma
                  semana na fila, avisa, sai e marca `expired`), squads
                  (lembrete, voice reservado e início das jogatinas, e o
                  passo diário de inatividade, guias e match)
  lib/            utilitários sem estado: embeds, template, cooldown, purge,
                  channels (onde o bot pode falar), guild-setup,
                  inviter-dm (todo o texto dos avisos a quem convidou)...
  api/            a API HTTP (Hono) — ver 4.4
```

### 4.3 Services

`src/services/` é onde mora a regra de negócio. Um comando ou evento deve ser
fino: valida entrada, chama um service, responde. Os principais:

| Service                   | Responsabilidade                                          |
| ------------------------- | --------------------------------------------------------- |
| `ConfigService`           | config de módulo por guild, **com cache e invalidate**     |
| `RegistryService`         | quem o bot atende; espelho em memória de `guild_registry`  |
| `ModerationService`       | ban/kick/timeout/warn, criação de caso, escalonamento      |
| `LogService` + `LogQueue` | roteia evento para o canal de log certo, com fila          |
| `AutomodService`          | avalia mensagem contra as regras ligadas                   |
| `StatsService`            | acumula buckets em memória e faz flush periódico           |
| `TicketService`           | abertura, transcript e fechamento                          |
| `SquadService`            | squads fixos: perfil, match, propostas, casa, guia, jogatinas |
| `ReactionRoleService`     | painéis por botão, menu ou reação                          |
| `AuditService`            | trilha do que o bot e o painel fizeram                     |
| `Scheduler`               | executa `scheduled_actions` (tempban, lembrete, unlock)    |
| `AlertService`            | manda alerta operacional por webhook                       |

> **Regra dura:** config de módulo é lida **sempre** pelo `ConfigService`,
> nunca por query direta dentro de um comando ou evento. O cache existe e uma
> leitura por fora dele devolve dado velho.

### 4.4 A API interna (`src/api/`)

Um app Hono. Desde a v1.1 ela está **exposta na internet** em `bot.<dominio>`,
porque o painel roda na Vercel, fora da VM.

```
api/
  server.ts        monta as rotas, body limit, request-id, rate limit
  middleware/
    auth.ts        Bearer em tempo constante (SHA-256 + timingSafeEqual)
    guild.ts       resolve :guildId para a Guild do cache do client
    rate-limit.ts  janela fixa em memória, por IP e por rota
  actor.ts         resolve actorId para GuildMember e checa nível/hierarquia
  validate.ts      wrapper do @hono/zod-validator
  errors.ts        ApiHttpError para código/mensagem estáveis
  mappers.ts       entidade discord.js para o DTO do shared
  routes/          uma rota por assunto (20 arquivos)
```

Rotas: `guild`, `bot-profile`, `channels`, `roles`, `members`, `messages`,
`moderation`, `cases`, `invites`, `events`, `expressions`, `automod`, `config`,
`commands`, `social`, `squads`, `metrics`, `health`, `admin`, `registry`.

Três invariantes que valem para **toda** rota nova:

1. **Bearer obrigatório.** A única exceção é `/health` (PRD §7.3).
2. **Validação Zod** do body, com o schema vindo de `@goodbot/shared`.
3. **`actorId` em toda escrita.** O Bearer prova que a chamada veio de um
   cliente autorizado, não *quem* pediu. É o `actorId` que decide o nível
   (`requireActor(deps, guild, id, 'admin')`) e a hierarquia
   (`assertRoleManageable`). Sem isso, um moderador poderia se promover pelo
   painel.

Há ainda `assertMayGrant`: ninguém concede uma permissão que ele próprio não
tem. O dono da guild é a única exceção, porque já tem tudo por definição.

`/admin` e `/registry` são as duas rotas fora de `/guilds/:guildId`, pela mesma
razão: elas existem para tratar servidores que o bot **não** atende — a fila de
aprovação e os avisos de recusa —, e o `withGuild` esconderia justamente esses.

No `/admin`, o `actorId` não é conferido contra uma guild: ele é comparado ao
`OWNER_DISCORD_ID` do ambiente. Sem a variável, toda escrita ali responde 403:
um `.env` incompleto não pode virar painel admin aberto.

O `/registry` não tem `actorId`, e isso é decisão: **não existe ator**. Quem
convidou já foi provado pela troca do `code` no OAuth, o destinatário da DM não
é escolhido pela chamada (é o `invited_by` da linha) e o corpo só escolhe qual
texto de uma lista fechada sai — o texto mora no bot, em `lib/inviter-dm.ts`.
Ela existe porque o bot **não sabe por qual link a pessoa veio**: o Discord
adiciona o bot no clique em "Autorizar", então o `guildCreate` chega antes de o
painel trocar o `code`. Quem sabe o fluxo é o painel, e é ele que pede o aviso.

---

## 5. `apps/web`

App Router. **Server Components por padrão**; `"use client"` só onde há estado
de formulário ou interação.

```
proxy.ts        CSP com nonce, porta do painel (`/`, `/servidores`, `/g/*`,
                `/admin`), rate limit e o roteamento por hostname (ver 5.1)
app/
  servidores/   o seletor: os servidores que ESTE usuário pode abrir
  admin/        o painel do dono do bot: saúde e uso, servidores, fila de
                aprovação e blocklist, broadcast e manutenção
  g/[guildId]/
    servidor, perfil-do-bot, canais, cargos, membros, casos, banidos,
    convites, eventos, emojis, mensagens, auditoria, system
    config/     general, moderation, automod, logs, welcome, autorole,
                reaction-roles, tickets, tags, social, squads, commands
  convite/      as telas dos links de convite (`invite.` e `demo.`)
  actions/      Server Actions: admin, auth, cases, config, guild, messages,
                modules, social, squads — toda escrita de guild recebe o `guildId`
                como primeiro argumento (ver 5.2)
  api/          auth (Auth.js), invite/{start,callback}, health,
                cases/export, discord/*
lib/
  hosts.ts          de qual dos quatro subdomínios veio a requisição (puro)
  site-url.ts       a URL absoluta de cada um, derivada do `AUTH_URL`
  invite/           state assinado, OAuth de convite e escrita no registro
  registry.ts       os servidores atendidos, lidos de `guild_registry`
  guilds.ts         os que este usuário pode abrir (registro ∩ nível na sessão)
  admin.ts          os dados e as escritas do painel do dono
  auth/owner.ts     a porta do `/admin`: `OWNER_DISCORD_ID`, e só ela
  internal-api.ts   o cliente da API do bot, com o token do servidor
  module-config.ts  ponte entre o form do painel e o schema Zod do módulo
  use-guild-id.ts   o `guildId` da rota, para o componente cliente (hook)
  auth/             Auth.js com provider Discord + checagem de nível
components/
  ui/         shadcn, editados no repositório
  retro/      os componentes do visual próprio (ver styleguide.md)
  config/     formulários de módulo
  charts/     estatísticas
```

### 5.1 Um projeto, quatro hostnames

O painel na Vercel serve quatro domínios, e quem os separa é o `proxy.ts`:

| Host                   | Serve                                      |
| ---------------------- | ------------------------------------------ |
| `goodbot.<domínio>`    | o painel                                   |
| `invite.<goodbot>`     | `/convite` no fluxo que entra como `pending` |
| `demo.<goodbot>`       | `/convite` no fluxo que entra como `demo`  |
| `admin.<goodbot>`      | `/admin`, o painel do dono do bot          |

A classificação é pelo **primeiro rótulo** do host (`lib/hosts.ts`), não por
uma lista de domínios em variável: trocar de domínio não mexe em código, e
`invite.localhost:3000` funciona em dev sem configuração. O que continua vindo
do ambiente é a URL absoluta (`AUTH_URL`), porque o `redirect_uri` do OAuth
tem de bater exatamente com o que está registrado no Discord — e montá-lo a
partir do header `Host` seria deixar o cliente escolher.

`invite.` e `demo.` servem **só** `/convite*` e `/api/*`; qualquer outro
caminho volta para a raiz do próprio host. Sem isso o painel inteiro
responderia num hostname que não deveria ter sessão. `admin.` serve só
`/admin*` e `/api/*`, e o host do painel comum redireciona `/admin` para lá: o
painel do dono tem um endereço só, e servir a mesma tela em dois é convite a
esquecer de trancar um deles.

**Entrar acontece num lugar só.** O `redirect_uri` do Auth.js aponta para o
host do painel, e é o único registrado no Discord; `admin.` não tem `/login`
próprio. Quem chega lá sem sessão é mandado para o `/login` do painel — no
`proxy.ts` e de novo no `requireBotOwner`, que redireciona para URL **absoluta**
justamente por isso: um `/login` relativo cairia na raiz de `admin.`, que
reescreve para `/admin`, que redireciona de novo. A troca de rótulo entre hosts
irmãos é o `hostForSite` de `lib/hosts.ts`.

**Por isso o cookie de sessão sai com `domain` explícito** (`auth.ts`). Sem ele
o cookie é *host-only* e o navegador não o manda para `admin.<host>`: quem
entrasse no painel chegaria no admin sem sessão, e o admin ficaria inalcançável
por construção. Com o `domain` do host do painel, ele vale também para
`invite.` e `demo.` — deliberado e pouco, porque esses dois servem só a tela de
convite, o cookie é `httpOnly` e o CSRF continua sendo o do Auth.js.

### 5.2 A guild vai explícita em toda escrita

O caminho de uma edição no painel:

```
form (client) ─▶ Server Action ─▶ lib/internal-api.ts ─▶ API do bot ─▶ Discord
   guildId da rota      │                                      │
                        └── grava config no Postgres ──────────┴─▶ invalidate
```

Toda action que escreve numa guild tem a forma `(guildId, formData)`, e o
`guildId` sai da rota — `useGuildId()` no componente cliente, que é o
`useParams` de `/g/[guildId]`. Nenhuma delas resolve a guild sozinha.

Isso é **tipo**, não convenção: um call site que esqueça a guild não compila.
A versão anterior deixava a action escolher "a primeira guild atendida", o que
funcionava enquanto o bot só atendia um servidor e, com mais de um, escrevia no
servidor errado sem erro nenhum — editando o servidor B, salvava no A. Quem
recebe o argumento é o `requireGuildAccess`, então a guild conferida é sempre a
guild escrita.

As rotas de apoio de `/api/*` não têm `params` para ler e recebem a guild na
query, pelo `lib/auth/guild-param.ts` (`?guildId=`); sem o parâmetro a rota
responde 404 em vez de adivinhar.

O `INTERNAL_API_TOKEN` vive **só no servidor** do Next. Nenhum componente
client vê o token, e o navegador nunca fala com a API do bot diretamente.

### 5.3 O painel não se atualiza sozinho

Até a Etapa 22 ele revalidava a rota a cada 10 segundos
(`components/layout/auto-refresh.tsx`). A conta não fechava: uma aba aberta
custava 360 invocações por hora na Vercel para mostrar números que, num
servidor de treze pessoas, não mudam nesse ritmo. No celular era pior — um
`router.refresh()` cujo pedido RSC falha faz o Next recarregar a página
inteira, e em rede móvel essa recarga também falha: sobrava a tela de erro do
browser, que parecia bug do painel.

Hoje quem atualiza é o botão da topbar (`components/layout/refresh.tsx`), e
ele faz duas coisas na ordem:

1. `refreshGuildData` (em `lib/stats.ts`) derruba a tag `stats:<guildId>` com
   `revalidateTag(..., { expire: 0 })` — sem isso o clique devolveria o mesmo
   dado cacheado e pareceria um botão quebrado;
2. o cliente chama `router.refresh()`, e o React troca só o que mudou.

As leituras do dashboard ficam em `unstable_cache` com TTL de 5 minutos e
todas sob a mesma tag, então **navegar entre telas é barato** e só o clique
paga o preço cheio. O único bloco fora do cache é `loadRecentAudit`: é um
`LIMIT 10` num índice e é onde dado velho mais incomoda.

O contador "ATUALIZADO HÁ 00:07" ficou, e importa mais agora do que antes: é a
única pista de quão velho está o que se está lendo.

**E a navegação não pré-carrega nada** (`prefetch={false}` em todo `<Link>`).
O padrão do Next é pré-carregar todo link que entra na viewport, o que é ótimo
num site de páginas estáticas e péssimo aqui: **toda** tela do painel é
dinâmica, porque toda uma passa por `auth()`. Cada prefetch é um render
completo no servidor, não um arquivo de cache. Com os treze itens da sidebar na
tela, abrir o dashboard disparava treze invocações na Vercel antes de alguém
clicar em qualquer coisa — e, chegando juntas, parte delas voltava 503. Quem dá
o retorno imediato do clique é o `loading.tsx` de `/g/[guildId]`, que já
existia.

---

## 6. `packages/db`

Drizzle, e só aqui.

```
src/
  client.ts        createDb(url)
  migrate.ts       roda as migrations (é um passo da CI, não do boot do bot)
  schema/          15 arquivos: guilds (+ guild_registry), configs, cases,
                   automod, community,
                   logs, messages, misc, social, squads, stats, audit, enums,
                   relations
  repositories/    18 arquivos: uma função por consulta, nunca SQL solto fora
drizzle/           16 migrations SQL versionadas
```

33 tabelas. As centrais: `guilds`, `guild_registry`, `guild_settings`,
`module_configs`, `cases`,
`audit_logs`, `automod_rules`, `automod_hits`, `scheduled_actions`,
`stat_buckets`, `tickets`, `reaction_role_panels`, `social_accounts`, `squads`
(as sete do módulo começam por `squad_`).

Fluxo obrigatório ao mexer no schema:

```bash
# 1. editar packages/db/src/schema/*.ts
pnpm --filter @goodbot/db db:generate   # gera SQL em drizzle/
#    revisar o SQL gerado À MÃO
pnpm --filter @goodbot/db db:migrate
```

Migration já aplicada **nunca** é editada. `db:push` não é usado fora de dev.

---

## 7. `packages/shared`

O contrato. Não depende de nada do projeto.

```
src/
  api/       schemas de request/response da API do bot + o CLIENTE tipado
             (client.ts, `createInternalClient`) + permissions.ts
  config/    um schema Zod por módulo (automod, logs, welcome, tickets...)
  constants.ts, duration.ts, snowflake.ts, templates.ts, errors.ts
```

Dois pontos que carregam mais peso do que parecem:

**`api/client.ts`** — `createInternalClient({ baseUrl, token })` devolve ~45
métodos tipados sobre a API do bot, cada um validando a resposta com o schema
correspondente. O painel usa. O `guild-config` usa. Qualquer script novo deve
usar em vez de montar `fetch` na mão.

**`api/permissions.ts`** — `PERMISSION_BITS` é uma lista **curada** das
permissões do Discord que o produto expõe. Um teste em `apps/bot` confere cada
bit contra o `PermissionFlagsBits` do discord.js, então um erro de digitação
quebra o `pnpm test` e não o servidor de alguém. O bitfield que a lista **não**
conhece é preservado ao salvar (`mergePermissions`) — salvar um cargo pelo
painel nunca apaga uma permissão nova do Discord.

---

## 8. `packages/guild-config`

Guild como código. Lê um `guild.yaml` declarativo, compara com o estado real e
emite só as chamadas que faltam.

```
infra/discord/<slug>/
  servidor.md  a análise em prosa, escrita pelo scan — VERSIONADO
  guild.yaml   estrutura desejada — VERSIONADO, sem nenhum ID dentro
  .env         GUILD_ID (+ ACTOR_ID opcional) — GITIGNORED
               INTERNAL_API_URL/TOKEN saem do .env da raiz

packages/guild-config/src/
  schema.ts   Zod do guild.yaml
  load.ts     lê o yaml, o .env do servidor e o .env da raiz
  state.ts    lê o estado atual pela API (uma chamada: GET /guilds/:id/state)
  scan.ts     acha a guild pelo nome e escreve a análise em servidor.md
  import.ts   o caminho inverso: estado atual -> guild.yaml
  plan.ts     o diff: estado atual x spec = lista de operações
  apply.ts    executa o plano com throttle e resolução nome para ID
  format.ts   imprime o plano; separa as remoções num bloco próprio
  cli.ts      `scan`, `import`, `plan` e `apply`
```

```bash
pnpm guild scan                     # lista os servidores em que o bot está
pnpm guild scan "<nome>"            # varre um: servidor.md + guild.yaml + .env
pnpm guild list
pnpm guild import --server <slug>   # só o yaml, numa pasta já configurada
pnpm guild plan   --server <slug>   # não escreve nada
pnpm guild apply  --server <slug>
```

Decisões que explicam o código:

- **O retrato vem numa chamada só.** `GET /guilds/:id/state` devolve cargos,
  canais e o detalhe de cada canal, montados do cache do gateway. O caminho
  antigo — `/roles`, `/channels` e um `/channels/:id` por canal — custava
  `2 + N` idas e voltas em série até a VM. `state.ts` mantém aquele caminho só
  como plano B, para quando o bot publicado ainda não tiver a rota.
- **`servidor.md` não é o yaml em outro formato.** Ele existe porque decidir o
  que mudar exige entender o que há, e um yaml longo descreve sem explicar. A
  seção de observações é o ponto: duplicação, categoria vazia, `@everyone` com
  permissão perigosa, o que está fora do alcance do formato.
- **Nenhum ID no yaml.** Tudo é por nome; `apply.ts` mantém um `Registry` que
  nasce do estado atual e cresce a cada criação. É o que torna o arquivo seguro
  num repositório público e aplicável em mais de um servidor.
- **Só os bits conhecidos entram no diff.** Como o bot preserva o resto do
  bitfield, comparar o bitfield inteiro faria todo apply reescrever todo cargo.
- **Nada é apagado sem `--allow-delete`**, e remoção ignora `--yes`: exige
  digitar `APAGAR`. Apagar canal leva as mensagens junto.
- **Reordenar cargos fica atrás de `--reorder`**: a API move uma casa por
  chamada, então a operação é O(n²) em chamadas.
- **Ordem de criação é a ordem do arquivo.** Cargo criado entra por baixo, o
  que reproduz naturalmente a ordem do yaml numa guild nova.
- **Override é comparado só nos cargos que o spec cita.** A rota de overrides
  edita um cargo por vez e não apaga quem ficou de fora, então comparar o
  conjunto inteiro faria o plano nunca convergir: o override do cargo do
  próprio bot voltaria como diferença em toda execução. Declarar `view` e
  `send` como `inherit` é como o yaml remove um override.
- **O import verifica a si mesmo.** Depois de escrever, ele relê o arquivo e
  monta o plano; se não sair vazio, a captura falhou e ele sai com erro.

Limitações honestas: override só expõe `view` e `send` (é o que a API oferece);
canal não tem campo de posição, então a ordem é a de criação; o casamento é por
nome — renomear no yaml é lido como "sumiu um, apareceu outro"; e fórum, palco,
tópico, emoji, sticker e evento ficam fora do spec (o import avisa e o apply não
os toca).

---

## 9. Seis fluxos de ponta a ponta

**Um slash command (`/ban`)**

```
interactionCreate ─▶ registry acha o comando ─▶ checa nível e cooldown
  ─▶ commands/moderation/ban.ts valida as opções (Zod de shared)
  ─▶ ModerationService.ban() ─▶ REST do Discord + INSERT em cases
  ─▶ modlog manda o embed do caso ─▶ resposta ao usuário
```

**Uma mudança de config no painel**

```
form ─▶ Server Action ─▶ schema Zod do módulo (shared/config/*)
  ─▶ UPDATE em module_configs ─▶ POST /guilds/:id/config/invalidate
  ─▶ ConfigService derruba o cache ─▶ próximo evento já lê o valor novo
```

**Uma mensagem passando pelo automod**

```
messageCreate ─▶ events/automod/messages.ts
  ─▶ ConfigService lê as regras da guild (cache)
  ─▶ AutomodService.evaluate() roda rules/{spam,links,caps,words,mentions}
  ─▶ bateu: actions.ts aplica (delete, warn, timeout) + grava automod_hits
  ─▶ LogService enfileira o log
```

**Um `pnpm guild apply`**

```
load.ts lê guild.yaml + .env ─▶ state.ts busca o retrato (GET /guilds/:id/state)
  ─▶ plan.ts monta a lista de operações ─▶ format.ts imprime e pede confirmação
  ─▶ apply.ts executa em ordem: cargos, categorias, canais, permissões
     (cada criação alimenta o Registry que a operação seguinte consulta)
```

**Um convite (`invite.` ou `demo.`)**

```
invite.<host>/convite ─▶ clique ─▶ GET /api/invite/start
  ─▶ lib/invite/state.ts assina <payload>.<hmac> (AUTH_SECRET, 15 min)
  ─▶ OAuth do Discord (scope bot+identify, redirect_uri do AUTH_URL)
  ─▶ GET /api/invite/callback: state válido? fluxo bate com o host?
  ─▶ lib/invite/discord.ts troca o code ─▶ prova a instalação e quem convidou
  ─▶ claimInvitedGuild: assume a linha que o guildCreate já criou
  ─▶ POST /registry/:id/notice ─▶ o bot manda a DM certa a quem convidou
  ─▶ /convite/pronto lê o REGISTRO (não a query) e diz o que aconteceu
```

Quatro coisas nesse caminho não são gosto:

- **O `state` é assinado** porque é ele que carrega o fluxo. Sem HMAC, trocar
  `pending` por `demo` na URL é auto-aprovação; e a TTL curta é o que impede
  reusar um `state` antigo. Ele é emitido no **clique**, não na renderização,
  senão uma aba esquecida aberta gera `state` vencido.
- **O `guild_id` da query é ignorado**: qualquer um digita um. Quem prova a
  instalação é a troca do `code`, e é ela que devolve `invitedBy`.
- **O `redirect_uri` sai do `AUTH_URL`**, nunca do header `Host` — quem manda
  o header é o cliente, e esse valor tem de bater exatamente com o que está no
  Developer Portal.
- **O `guildCreate` ganha do callback, sempre.** O Discord adiciona o bot no
  clique em "Autorizar", então a linha já nasceu `pending` quando este caminho
  vai gravar. É por isso que o convite tem escrita própria
  (`claimInvitedGuild`) em vez do `ensureGuildRegistered`: ela **assume** a
  linha quando o status é `pending`, `expired` ou uma `demo` já gasta. Sem
  isso — como era até a v1.4 — o link da demonstração entregava um servidor
  `pending`: demo nenhuma, nunca.
- **O que ela nunca toca** resolve o resto numa regra: `approved` não volta
  para a fila, `blocked` continua bloqueado, e uma demo em curso não é
  derrubada por um clique no link normal. A demo não se renova porque prazo
  novo exige `demo_ended_at` nulo — a memória é a coluna, não o status.

**Um match de squad**

```
botão da mensagem fixa ─▶ interactions/squads.ts ─▶ modal (respostas)
  ─▶ grade da semana (a máscara viaja no custom_id) ─▶ SquadService.saveAvailability
  ─▶ perfil `searching` ─▶ MatcherService.runFor(guild, jogo)
  ─▶ proposeGroups (shared, puro, turma de até partySize) ─▶ thread privada + Aceito/Passo + INSERT squad_proposals
  ─▶ primeiro "Aceito": uma transação cria `squads` e reivindica a proposta
  ─▶ canal privado na categoria ─▶ GuideService.publish (guia pinado, chama os membros)
```

**Uma jogatina**

```
/bora hoje 21h (commands/community/bora.ts) ou BORA no guia ─▶ modal (quando)
  ─▶ SessionService.scheduleFromText ─▶ parseWhen (shared, fuso da guild)
  ─▶ INSERT squad_sessions (quem marcou já vai) ─▶ mensagem com VOU / NÃO VOU / CANCELAR
  ─▶ GuideService.refresh ─▶ SquadsJob (5 min): lembrete + reserva do voice (snapshot na jogatina)
  ─▶ na hora, move os membros ─▶ voiceStateUpdate (events/community/squads-voice.ts) marca played_at
  ─▶ fim da jogatina ou voice vazio: restaura os overwrites e só então marca liberado
  ─▶ REPETIR marca a mesma hora na semana seguinte
```

Três coisas nesses caminhos não são gosto:

- **A regra mora em `shared`, o efeito no bot.** `squads/availability.ts`,
  `squads/match.ts`, `squads/when.ts` e `squads/zoned.ts` são puros: máscara da
  grade, agrupamento determinístico em parties, "cabe no squad" (`fitsSquad`), o "quando"
  do `/bora` e o relógio de parede no fuso da guild (com horário de verão). O painel e os testes usam
  as mesmas funções, sem Discord nem banco.
- **A trava é do banco, não da memória.** Botão é clicado duas vezes e por
  várias pessoas ao mesmo tempo, e o job passa de novo a cada 5 minutos. Todo
  passo é uma `UPDATE` condicional (`claimProposalSquad`, `markSessionReminded`,
  votos com `array_append`) antes de qualquer chamada ao Discord. O único estado
  em memória é a fila compartilhada por guild e jogo do `MatcherService`
  (`withGameLock`): a passada do matcher, o match manual e apagar perfil entram
  nela, e uma tarefa na fila nunca espera `runFor` do mesmo jogo, senão espera a
  si mesma. Ela só vale porque o bot é uma instância só; escalar para mais de
  uma instância pediria trava no banco.
- **Restaurar antes de marcar.** A liberação do voice devolve os overwrites no
  Discord e só depois grava `voice_released_at`. Na ordem inversa, uma falha
  passageira deixaria o voice do pool fechado ao `@everyone` sem nada que o
  reabrisse.

**Um match manual**

```
aba JOGADORES: o admin marca linhas ─▶ manualMatchPeople + evaluateManualMatch
  (shared, puro, com o dado do carregamento) mostram nota e avisos na hora
  ─▶ PROPOR AO GRUPO ─▶ action do painel ─▶ POST /squads/games/:gameId/manual/check
  ─▶ ManualMatchService.check: uma leitura por tipo no banco + isGuildMember
  ─▶ o diálogo mostra duplas, janela, bloqueios e avisos (cada um com `key`)
  ─▶ confirmar ─▶ POST .../manual/propose { userIds, confirmedWarnings }
  ─▶ matcher.withGameLock(guild, jogo): recarrega tudo e avalia de novo
     bloqueio ─▶ 422 MANUAL_MATCH_BLOCKED
     aviso fora de confirmedWarnings ─▶ 409 MANUAL_MATCH_UNCONFIRMED
  ─▶ matcher.searchChannel ─▶ matcher.openProposal (o mesmo do automático)
  ─▶ nota "turma escolhida no painel" na thread ─▶ auditoria squad.proposal.manual
  ─▶ daqui em diante é o caminho de cima: Aceito, Passo, prazo e cooldown
```

Duas coisas nesse caminho, e na gestão de jogadores ao lado dele, não são gosto:

- **A revisão roda de novo dentro da fila.** A avaliação do painel usa o dado do
  carregamento da página; a do bot lê o banco e a presença no servidor na hora
  (`SquadContext.isGuildMember`: `false` só com "Unknown Member", e falha
  passageira não bloqueia). A confirmação é a lista de `key`s vistas, não um
  booleano: a segunda chamada de um clique duplo vê a proposta que a primeira
  abriu e cai em `IN_OPEN_PROPOSAL`.
- **Ação de admin avisa por DM, e a DM nunca derruba a ação.** Pausar, retomar,
  editar respostas, apagar perfil e tirar do squad (`PlayerAdminService`) seguem
  checagens, efeito, auditoria com o motivo e só então a DM:
  `SquadContext.sendDm`, com a copy de `adminActionDm` em `embeds.ts`. `sendDm`
  nunca lança (a rota devolve `notified: false`) e não loga o erro, só IDs, ação
  e código do Discord, porque o `DiscordAPIError` carrega o corpo da requisição
  com o texto da DM e o motivo. Apagar perfil manda a DM depois de soltar a fila.

---

## 10. Invariantes do projeto

Regras que valem em todo lugar; quebrar uma delas é bug, não estilo.

1. **ID do Discord é `string`.** Nunca `Number(snowflake)` — snowflake estoura
   o `Number` com precisão silenciosa.
2. **Todo query filtra por `guildId`,** e nada assume "a" guild. A única
   exceção é o painel do dono do bot (`apps/web/lib/admin.ts`), que existe
   justamente para olhar o conjunto — e ela é fechada por
   `OWNER_DISCORD_ID`. Quem o bot
   atende vem do registro (`guild_registry`, via `RegistryService`), não de uma
   variável; no painel, quem decide acesso é a guild da URL, o nível de
   permissão é por guild na sessão, e toda action de escrita recebe o `guildId`
   no primeiro argumento (§5.2) — nenhuma resolve a guild sozinha. O registro
   vale nos **dois** caminhos de
   entrada: interação (`lib/interaction.ts`) e evento do gateway
   (`lib/loader.ts`). Handler novo não precisa lembrar de checar — o
   `loadEvents` descarta antes; a exceção é `always: true`, hoje só
   `guildCreate`/`guildDelete`.
3. **Todo input externo passa por Zod de `shared`** — opção de comando, body da
   API, formulário do painel, jsonb de config. Bot e painel importam o mesmo
   schema.
4. **Config de módulo só pelo `ConfigService`.**
5. **`pino`, nunca `console.log`** fora de scripts. Nunca logar token, header
   ou conteúdo de mensagem em nível `info`.
6. **`UserFacingError`** para o que vira embed ou toast; o resto sobe e é
   logado. Handler de interação sempre responde (efêmero em erro).
7. **Rota nova = Bearer + Zod + rate limit.** Sem exceção além de `/health`.
8. **Segredo nunca no repositório.** Só `.env.example`, documentado.
9. **`pnpm`, nunca `npm`/`yarn`.** Node 22 LTS.

## 11. Onde mexer, por tipo de tarefa

| Quero...                          | Vou em                                                                  |
| --------------------------------- | ----------------------------------------------------------------------- |
| adicionar um slash command        | `apps/bot/src/commands/<módulo>/` + registrar no `index.ts` do módulo    |
| reagir a um evento do gateway     | `apps/bot/src/events/<assunto>/`                                         |
| mudar regra de automod            | `apps/bot/src/automod/rules/` + o schema em `shared/config/automod*.ts`  |
| expor algo novo para o painel     | rota em `apps/bot/src/api/routes/` + schema e método em `shared/api/`    |
| criar uma tela                    | `apps/web/app/g/[guildId]/` + Server Action em `app/actions/`            |
| mexer no painel do dono do bot    | `apps/web/app/admin/` + `lib/admin.ts` + rota em `api/routes/admin.ts`   |
| mudar o texto de um aviso ao dono do servidor | `apps/bot/src/lib/inviter-dm.ts` (todos moram lá)            |
| adicionar campo de config         | `shared/config/<módulo>.ts` → form em `apps/web/components/config/`      |
| mexer no banco                    | `packages/db/src/schema/` → `db:generate` → revisar SQL → `db:migrate`   |
| tarefa periódica                  | `apps/bot/src/jobs/` + registrar no `Scheduler`                          |
| mexer em squads fixos             | `apps/bot/src/services/squads/` (fachada no `index.ts`) + regra pura em `shared/src/squads/` |
| mexer na jogatina (`/bora`)       | `apps/bot/src/services/squads/sessions.ts` + "quando" em `packages/shared/src/squads/when.ts` |
| mexer no guia fixo do squad       | `apps/bot/src/services/squads/guide.ts` (texto em `guideMessage`, `embeds.ts`) |
| mexer no match manual             | `apps/bot/src/services/squads/manual.ts` + regra pura em `packages/shared/src/squads/manual.ts` |
| mexer na gestão de jogadores      | `apps/bot/src/services/squads/players.ts` (texto da DM em `embeds.ts`)   |
| entender um servidor              | `pnpm guild scan "<nome>"` → `infra/discord/<slug>/servidor.md`          |
| mudar a estrutura de um servidor  | `infra/discord/<slug>/guild.yaml` → `pnpm guild plan`                    |

## 12. Armadilhas conhecidas

- **Rate limit da API**: 600/min por IP e por rota para quem tem o token; 60
  para quem não tem. O `guild apply` respeita 120 ms entre chamadas.
- **Hierarquia**: o cargo do bot precisa estar **acima** de todo cargo que ele
  gerencia, senão a operação falha com `BOT_ROLE_HIERARCHY`.
- **`moveRole` anda uma casa por chamada.** Não existe "definir posição".
- **Migrations não rodam no boot do bot** — são um passo da CI.
- **`INTERNAL_API_TOKEN` vive em três cofres**: `.env` da VM, GitHub Secrets e
  variáveis do projeto na Vercel. Rotacionar é trocar nos três de uma vez.
- **`OWNER_DISCORD_ID` vale nos dois lados**: o painel confere antes de
  renderizar `/admin`, e o bot confere de novo o `actorId` de toda escrita ali.
  Faltando em qualquer um dos dois, aquele lado fecha — o que dá o sintoma
  "a tela abre e o botão responde 403".
- **Ambiente de desenvolvimento**: Windows + WSL2, repositório em `/mnt/c/...`
  sincronizado pelo OneDrive. `node_modules` fica fora do OneDrive.

## 13. Validação

Antes de dar qualquer trabalho por concluído:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

115 arquivos de teste, ~1.280 casos (Vitest). Os testes de integração de
repository precisam de um Postgres e são pulados sem ele.
