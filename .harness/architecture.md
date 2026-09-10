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
                   │ 25 tabelas     │   Docker local em dev)
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
| `packages/guild-config` | Guild como código: lê `guild.yaml` e aplica pela API do bot     |

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

No `ready`, cada guild de `GUILD_IDS` é preparada por vez (upsert, cache de
membros, config, guild commands). Guild ausente vira log de erro e não impede
as outras — convidar o bot é ação manual e pode estar pendente só para a mais
nova. Os dois recursos do processo (LRU de mensagens, intervalo de flush das
stats) recebem o maior cache e o menor intervalo entre as guilds.

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
    community/    tag, ticket, reactionrole, welcome, verify, social
    utilities/    clear, lock, slowmode, poll, remind, info, stats, say

  events/         handlers de evento do gateway, agrupados por assunto
    automod/      messages, members
    logs/         messages, members, server, voice
    community/    members, reaction-roles
    stats/        contagem

  automod/        o motor: engine.ts + rules/{spam,links,caps,words,mentions}
  services/       a lógica de verdade; ver abaixo
  jobs/           tarefas periódicas: retention, social, stats-rollup
  lib/            utilitários sem estado: embeds, template, cooldown, purge...
  api/            a API HTTP (Hono) — ver 4.4
```

### 4.3 Services

`src/services/` é onde mora a regra de negócio. Um comando ou evento deve ser
fino: valida entrada, chama um service, responde. Os principais:

| Service                   | Responsabilidade                                          |
| ------------------------- | --------------------------------------------------------- |
| `ConfigService`           | config de módulo por guild, **com cache e invalidate**     |
| `ModerationService`       | ban/kick/timeout/warn, criação de caso, escalonamento      |
| `LogService` + `LogQueue` | roteia evento para o canal de log certo, com fila          |
| `AutomodService`          | avalia mensagem contra as regras ligadas                   |
| `StatsService`            | acumula buckets em memória e faz flush periódico           |
| `TicketService`           | abertura, transcript e fechamento                          |
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
  routes/          uma rota por assunto (16 arquivos)
```

Rotas: `guild`, `channels`, `roles`, `members`, `messages`, `moderation`,
`cases`, `invites`, `events`, `expressions`, `automod`, `config`, `commands`,
`social`, `metrics`, `health`.

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

---

## 5. `apps/web`

App Router. **Server Components por padrão**; `"use client"` só onde há estado
de formulário ou interação.

```
app/
  g/[guildId]/
    servidor, canais, cargos, membros, casos, banidos, convites,
    eventos, emojis, mensagens, auditoria, system
    config/     general, moderation, automod, logs, welcome, autorole,
                reaction-roles, tickets, tags, social, commands
  actions/      Server Actions: auth, cases, config, guild, messages,
                modules, social
  api/          auth (Auth.js), health, cases/export, discord/*
lib/
  internal-api.ts   o cliente da API do bot, com o token do servidor
  module-config.ts  ponte entre o form do painel e o schema Zod do módulo
  auth/             Auth.js com provider Discord + checagem de nível
components/
  ui/         shadcn, editados no repositório
  retro/      os componentes do visual próprio (ver styleguide.md)
  config/     formulários de módulo
  charts/     estatísticas
```

O caminho de uma edição no painel:

```
form (client) ─▶ Server Action ─▶ lib/internal-api.ts ─▶ API do bot ─▶ Discord
                       │                                      │
                       └── grava config no Postgres ──────────┴─▶ invalidate
```

O `INTERNAL_API_TOKEN` vive **só no servidor** do Next. Nenhum componente
client vê o token, e o navegador nunca fala com a API do bot diretamente.

---

## 6. `packages/db`

Drizzle, e só aqui.

```
src/
  client.ts        createDb(url)
  migrate.ts       roda as migrations (é um passo da CI, não do boot do bot)
  schema/          14 arquivos: guilds, configs, cases, automod, community,
                   logs, messages, misc, social, stats, audit, enums, relations
  repositories/    16 arquivos: uma função por consulta, nunca SQL solto fora
drizzle/           6 migrations SQL versionadas
```

25 tabelas. As centrais: `guilds`, `guild_settings`, `module_configs`, `cases`,
`audit_logs`, `automod_rules`, `automod_hits`, `scheduled_actions`,
`stat_buckets`, `tickets`, `reaction_role_panels`, `social_accounts`.

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
  guild.yaml   estrutura desejada — VERSIONADO, sem nenhum ID dentro
  .env         GUILD_ID, ACTOR_ID, INTERNAL_API_URL/TOKEN — GITIGNORED

packages/guild-config/src/
  schema.ts   Zod do guild.yaml
  load.ts     lê o yaml e o .env do servidor
  state.ts    lê o estado atual pela API (roles, channels, detalhe de cada um)
  import.ts   o caminho inverso: estado atual -> guild.yaml
  plan.ts     o diff: estado atual x spec = lista de operações
  apply.ts    executa o plano com throttle e resolução nome para ID
  format.ts   imprime o plano; separa as remoções num bloco próprio
  cli.ts      `plan` e `apply`
```

```bash
pnpm guild list
pnpm guild import --server <slug>   # captura um servidor existente
pnpm guild plan   --server <slug>   # não escreve nada
pnpm guild apply  --server <slug>
```

Decisões que explicam o código:

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

## 9. Quatro fluxos de ponta a ponta

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
load.ts lê guild.yaml + .env ─▶ state.ts busca cargos, canais e cada detalhe
  ─▶ plan.ts monta a lista de operações ─▶ format.ts imprime e pede confirmação
  ─▶ apply.ts executa em ordem: cargos, categorias, canais, permissões
     (cada criação alimenta o Registry que a operação seguinte consulta)
```

---

## 10. Invariantes do projeto

Regras que valem em todo lugar; quebrar uma delas é bug, não estilo.

1. **ID do Discord é `string`.** Nunca `Number(snowflake)` — snowflake estoura
   o `Number` com precisão silenciosa.
2. **Todo query filtra por `guildId`,** e nada assume "a" guild. O bot atende
   a lista de `GUILD_IDS`; no painel, quem decide acesso é a guild da URL e o
   nível de permissão é por guild na sessão.
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
| adicionar campo de config         | `shared/config/<módulo>.ts` → form em `apps/web/components/config/`      |
| mexer no banco                    | `packages/db/src/schema/` → `db:generate` → revisar SQL → `db:migrate`   |
| tarefa periódica                  | `apps/bot/src/jobs/` + registrar no `Scheduler`                          |
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
- **Ambiente de desenvolvimento**: Windows + WSL2, repositório em `/mnt/c/...`
  sincronizado pelo OneDrive. `node_modules` fica fora do OneDrive.

## 13. Validação

Antes de dar qualquer trabalho por concluído:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

69 arquivos de teste, ~780 casos (Vitest). Os testes de integração de
repository precisam de um Postgres e são pulados sem ele.
