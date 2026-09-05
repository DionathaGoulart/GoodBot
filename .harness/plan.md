# CoBot — Plano de execução por etapas

Cada etapa cabe em **uma sessão** do Claude Code com contexto limpo. Regras:

- Leia só o "Contexto mínimo" da etapa. Não leia o repositório inteiro.
- Atualize a tabela **Estado** ao iniciar (`em andamento`) e ao terminar
  (`concluída · AAAA-MM-DD`). Marque os checkboxes das tarefas.
- `⚠️ AÇÃO MANUAL` = o usuário precisa fazer algo fora do código. Pare, explique
  exatamente o que fazer e aguarde confirmação antes de seguir.
- Toda etapa termina com validação (`pnpm lint && pnpm typecheck && pnpm test
&& pnpm build`, mais o que a etapa listar) e a linha final obrigatória.
- Nomes dos pacotes: `@cobot/bot`, `@cobot/web`, `@cobot/db`, `@cobot/shared`.

## Estado

| #   | Etapa                                                                      | Status       |
| --- | -------------------------------------------------------------------------- | ------------ |
| 1   | Setup do monorepo e tooling                                                | concluída · 2026-09-05 |
| 2   | `packages/shared` e `packages/db` (schema base + migrations)               | pendente     |
| 3   | Esqueleto do bot (login, handlers, registro de comandos, config com cache) | pendente     |
| 4   | Moderação e casos                                                          | pendente     |
| 5   | Mod-log e logs de eventos                                                  | pendente     |
| 6   | Automod                                                                    | pendente     |
| 7   | Utilidades                                                                 | pendente     |
| 8   | Comunidade I: boas-vindas, autorole, tags                                  | pendente     |
| 9   | Comunidade II: reaction roles, tickets                                     | pendente     |
| 10  | Coleta de estatísticas                                                     | pendente     |
| 11  | API interna do bot (Hono)                                                  | pendente     |
| 12  | Esqueleto do painel (Next.js, Auth.js, layout, 2 temas)                    | pendente     |
| 13  | Dashboard de estatísticas                                                  | pendente     |
| 14  | Configuração I: geral, moderação, logs, boas-vindas, autorole, tags        | pendente     |
| 15  | Configuração II: automod, reaction roles, tickets, comandos                | pendente     |
| 16  | Gestão do servidor: membros, cargos, canais                                | pendente     |
| 17  | Casos e auditoria do painel                                                | pendente     |
| 18  | Docker Compose + Caddy (linux/arm64)                                       | pendente     |
| 19  | CI/CD (GitHub Actions) e deploy na Oracle                                  | pendente     |
| 20  | Hardening e observabilidade                                                | pendente     |

---

## Etapa 1 — Setup do monorepo e tooling

**Contexto mínimo para esta etapa:** `CLAUDE.md`, `.harness/prd.md` §12
(decisões), esta etapa. Nenhum código existe ainda.

**Objetivo:** repositório pnpm workspaces com os quatro pacotes vazios mas
compiláveis, lint/format/typecheck/test na raiz, `.env.example`, git
inicializado.

**Pré-requisitos:** nenhum. Node 22 e pnpm 9+ instalados no WSL
(`corepack enable && corepack prepare pnpm@latest --activate`).

**Tarefas:**

- [x] `git init`, `.gitignore` (node_modules, dist, .next, .env*, !.env.example,
      *.log, .turbo, coverage), `.editorconfig`, `.nvmrc` (22).
- [x] `package.json` raiz (`private`, `packageManager: pnpm@9.x`, `engines`),
      `pnpm-workspace.yaml` (`apps/*`, `packages/*`).
- [x] `tsconfig.base.json` (strict, `moduleResolution: bundler`, `target
    ES2022`, `verbatimModuleSyntax`, paths não necessários — usar deps de
      workspace).
- [x] ESLint flat config na raiz (`typescript-eslint`, `eslint-plugin-import`,
      regra `no-console: error` exceto em `scripts/`), Prettier
      (`.prettierrc`: semi, singleQuote, printWidth 100).
- [x] Vitest na raiz com `vitest.workspace.ts` apontando para os 4 pacotes.
- [x] Criar os quatro pacotes com `package.json`, `tsconfig.json` (extends
      base) e um `src/index.ts` mínimo: - `packages/shared` (`@cobot/shared`): exporta `export const VERSION`. - `packages/db` (`@cobot/db`): idem; deps `drizzle-orm`, `postgres`,
      devDep `drizzle-kit`. - `apps/bot` (`@cobot/bot`): `src/index.ts` que só loga "boot" com pino;
      deps `discord.js`, `pino`, `pino-pretty` (dev), `tsx` (dev), `tsup`. - `apps/web` (`@cobot/web`): criado com
      `pnpm dlx create-next-app@latest apps/web --ts --tailwind --eslint --app
      --src-dir=false --import-alias "@/*" --use-pnpm`; remover boilerplate
      da home; deixar página "CoBot" em texto.
- [x] Scripts na raiz: `dev` (concurrently bot+web), `build`, `lint`,
      `format`, `typecheck` (`pnpm -r typecheck`), `test` (`vitest run`),
      `db:generate`/`db:migrate` (filtrando `@cobot/db`).
- [x] `.env.example` com TODAS as variáveis do projeto já documentadas
      (`DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`,
      `GUILD_ID`, `DATABASE_URL`, `INTERNAL_API_TOKEN`, `INTERNAL_API_URL`,
      `AUTH_SECRET`, `AUTH_URL`, `NODE_ENV`, `LOG_LEVEL`, `TZ`).
- [x] `infra/docker-compose.dev.yml` com só o Postgres 16 (`postgres:16-
    alpine`, porta 5432, volume nomeado, healthcheck).
- [x] `README.md` curto (o que é, como rodar, link para `.harness/`).
- [x] Um teste trivial em `packages/shared/src/index.test.ts` para provar o
      Vitest.
- [x] Commit inicial `chore: setup do monorepo`.

**Arquivos criados:** todos os acima.

**Critérios de aceite:**

- `pnpm install` sem warnings de peer deps críticos.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` passam (build do
  web gera `.next`; do bot gera `dist/index.js`).
- `pnpm --filter @cobot/bot dev` imprime o log de boot e encerra/aguarda sem
  erro (sem token ainda).
- `docker compose -f infra/docker-compose.dev.yml up -d` sobe o Postgres
  saudável.
- `.env` não está no `git status`.

**Comandos de validação:**

```bash
pnpm install
pnpm lint && pnpm typecheck && pnpm test && pnpm build
docker compose -f infra/docker-compose.dev.yml up -d && docker compose -f infra/docker-compose.dev.yml ps
git status --short   # não pode listar .env
```

**Notas de execução (2026-09-05):**

- Vitest 4 removeu o `vitest.workspace.ts`; os 4 projetos estão em
  `vitest.config.ts` (`test.projects`).
- ESLint fixado em 9.x: `eslint-plugin-import` 2.32 ainda não suporta ESLint 10.
  `apps/web` usa a própria `eslint.config.mjs` (eslint-config-next) e a config
  da raiz ignora `apps/web`; `pnpm lint` roda as duas.
- `packages/shared` e `packages/db` são consumidos direto do fonte (`exports`
  → `src/index.ts`): o bot bundla via `tsup` (`noExternal`) e o web via
  `transpilePackages`. Por isso não têm script `build`.
- `typecheck` do web roda `next typegen` antes do `tsc` (tipos globais como
  `LayoutProps` vivem em `.next/types`).
- Node 22 + pnpm 9 instalados no WSL via nvm/corepack (não havia Node).
- ⚠️ Docker não está instalado (nem no WSL nem Docker Desktop no Windows): o
  critério "Postgres saudável" fica pendente até a instalação. O
  `infra/docker-compose.dev.yml` foi escrito e será validado na Etapa 2.

▶ Etapa concluída. Rode /clear antes de iniciar a próxima etapa para limpar o contexto.

---

## Etapa 2 — `packages/shared` e `packages/db` (schema base + migrations)

**Contexto mínimo para esta etapa:** `CLAUDE.md`, `.harness/prd.md` §5 (só os
títulos dos módulos), §8 (modelo de dados) e §9 (permissões), esta etapa,
`packages/shared/package.json`, `packages/db/package.json`, `.env.example`.

**Objetivo:** schemas Zod de todas as configs de módulo e enums do domínio em
`shared`; schema Drizzle completo do PRD §8 em `db` com a primeira migration
aplicada e um client exportado.

**Pré-requisitos:** Etapa 1.

**Tarefas — shared:**

- [ ] `src/constants.ts`: `MODULES` (lista), `CASE_TYPES`, `CASE_SOURCES`,
      `AUTOMOD_RULE_TYPES`, `AUTOMOD_ACTIONS`, `LOG_KINDS`, `STAT_KINDS`,
      `PERMISSION_LEVELS`, limites (`MAX_TIMEOUT_MS = 28d`, `MAX_PURGE = 500`).
- [ ] `src/duration.ts`: `parseDuration('1h30m') → ms | null` e
      `formatDuration(ms)`; testes.
- [ ] `src/snowflake.ts`: `isSnowflake`, `snowflakeToDate`; testes.
- [ ] `src/config/<module>.ts` para cada módulo (`general`, `moderation`,
      `automod`, `logs`, `welcome`, `autorole`, `reactionRoles`, `tickets`,
      `tags`, `utilities`, `stats`): schema Zod com `.default()` em tudo,
      `DEFAULT_<MODULE>_CONFIG`, tipo inferido, `version: z.literal(1)`.
      `src/config/index.ts` exporta `MODULE_SCHEMAS` (mapa módulo → schema).
- [ ] `src/config/automod-rule.ts`: schema discriminado por `type` com o
      `config` específico de cada regra e `actions[]` (PRD §5.2).
- [ ] `src/templates.ts`: `renderTemplate(str, vars)` para
      `{user}`/`{server}`/… e schema `MessageTemplate` (`content?`,
      `embed?`); testes.
- [ ] `src/api/*.ts`: schemas dos payloads da API interna (PRD §5.7) —
      `ModerationActionInput`, `InvalidateInput`, `MemberSearchQuery`, etc.
- [ ] `src/errors.ts`: `UserFacingError`.
- [ ] Testes: todo schema de config aceita `{}` e produz o default; regras
      de automod inválidas são rejeitadas.

**Tarefas — db:**

- [ ] `drizzle.config.ts` (dialect postgresql, `schema: ./src/schema`,
      `out: ./drizzle`, `DATABASE_URL`).
- [ ] `src/schema/` um arquivo por grupo: `guilds.ts`, `configs.ts`
      (`guild_settings`, `module_configs`, `log_configs`), `cases.ts`
      (`cases`, `scheduled_actions`), `automod.ts`, `messages.ts`
      (`message_cache`), `community.ts` (welcome, autorole, reaction roles,
      ticket_*, tags), `misc.ts` (reminders, polls, meta), `stats.ts`,
      `audit.ts`. Enums pg para `case_type`, `case_source`, etc. importando
      as listas de `@cobot/shared`. Índices do PRD §8. `src/schema/index.ts`
      reexporta tudo + `relations`.
- [ ] `src/client.ts`: `createDb(url)` com `postgres` (`max: 5`) e
      `drizzle(...)`; `src/index.ts` exporta client, schema e tipos
      (`InferSelectModel`).
- [ ] Scripts: `db:generate`, `db:migrate` (script `src/migrate.ts` com
      `drizzle-orm/postgres-js/migrator`), `db:studio`.
- [ ] Gerar migration `0000_init` e aplicar no Postgres de dev.
- [ ] `src/repositories/` mínimos usados por todos: `configs.ts`
      (`getModuleConfig(guildId, module)` que valida com o Zod do shared e
      aplica default; `setModuleConfig`), `cases.ts` (`nextCaseNumber` via
      `INSERT … RETURNING` com subquery `max+1` em transação),
      `audit.ts` (`appendAudit`).
- [ ] Teste de integração (Vitest, pula se `DATABASE_URL` ausente):
      `setModuleConfig` → `getModuleConfig` roundtrip; `nextCaseNumber`
      sequencial.

**Arquivos criados/alterados:** `packages/shared/src/**`, `packages/db/src/**`,
`packages/db/drizzle/0000_*.sql`, `packages/db/drizzle.config.ts`.

**Critérios de aceite:**

- `pnpm db:generate` não gera diff novo após a `0000_init` (schema estável).
- `pnpm db:migrate` aplica no Postgres de dev; `\dt` lista todas as tabelas do
  PRD §8.
- `pnpm test` roda os testes de shared e o de integração de db.
- Nenhum hex, string mágica de módulo ou tipo de caso fora de `constants.ts`.

**Comandos de validação:**

```bash
docker compose -f infra/docker-compose.dev.yml up -d
pnpm db:generate && pnpm db:migrate
docker compose -f infra/docker-compose.dev.yml exec postgres psql -U cobot -d cobot -c '\dt'
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

▶ Etapa concluída. Rode /clear antes de iniciar a próxima etapa para limpar o contexto.

---

## Etapa 3 — Esqueleto do bot

**Contexto mínimo para esta etapa:** `CLAUDE.md`, `.harness/prd.md` §5.7
(só a ideia de `ConfigBus`), §7.1, §7.4, §9.1, §10, esta etapa,
`packages/shared/src/index.ts`, `packages/shared/src/config/index.ts`,
`packages/db/src/index.ts`, `packages/db/src/repositories/configs.ts`,
`apps/bot/package.json`, `.env.example`.

**Objetivo:** bot que loga no Discord, carrega comandos e eventos de pastas,
registra slash commands na guild, tem `ConfigService` com cache + invalidação,
sistema de permissões (admin/mod/member), respostas de erro padronizadas e
`/ping` + `/help` funcionando.

**Pré-requisitos:** Etapas 1–2.

**⚠️ AÇÃO MANUAL (antes de codar):**

1. Criar a aplicação em https://discord.com/developers/applications → aba
   _Bot_ → _Reset Token_ → copiar para `DISCORD_TOKEN`. Copiar _Application
   ID_ para `DISCORD_CLIENT_ID`.
2. Na aba _Bot_, habilitar **Privileged Gateway Intents**: _Server Members
   Intent_ e _Message Content Intent_ (Presence **não**).
3. Aba _OAuth2 → URL Generator_: scopes `bot` + `applications.commands`;
   permissões do PRD §10 (não marcar Administrator). Abrir a URL e adicionar
   o bot ao servidor de testes. Copiar o ID do servidor para `GUILD_ID`
   (Modo desenvolvedor → clicar com botão direito no servidor → Copiar ID).
4. Preencher `.env` (nunca commitar).

**Tarefas:**

- [ ] `src/env.ts`: Zod parse de `process.env` (falha rápido com mensagem).
- [ ] `src/logger.ts`: pino com `redact: ['token', '*.authorization']`,
      `pino-pretty` só em dev.
- [ ] `src/client.ts`: `Client` com intents do PRD §10, `partials` (Message,
      Channel, Reaction, GuildMember), `makeCache` com limites (mensagens
      200/canal).
- [ ] `src/lib/command.ts`: tipo `Command { data: SlashCommandBuilder |
    ContextMenuCommandBuilder, module, level: 'admin'|'mod'|'member',
    cooldown?, execute(ctx), autocomplete?(ctx) }` + `defineCommand()`.
      `src/lib/event.ts`: `defineEvent(name, once?, execute)`.
- [ ] `src/lib/loader.ts`: importa `src/commands/**/*.ts` e
      `src/events/**/*.ts` via `import.meta.glob`-equivalente (lista
      explícita gerada ou `fast-glob` + dynamic import).
- [ ] `src/lib/registry.ts`: monta o manifesto JSON dos comandos, calcula
      hash SHA-256, compara com `meta.commands_hash` no DB e só faz
      `rest.put(Routes.applicationGuildCommands)` se mudou (ou `--force`).
- [ ] `src/services/config.ts`: `ConfigService` com `get(guildId, module)`
      (cache `Map`, TTL 5 min), `invalidate(guildId, module?)`,
      `ConfigBus` interface (`publish`, `subscribe`) com impl. em memória.
- [ ] `src/services/permissions.ts`: `resolveLevel(member, settings)` →
      `admin|mod|member`; `canActOn(actor, target)` (hierarquia de cargos,
      owner, bot).
- [ ] `src/lib/interaction.ts`: wrapper do handler de `interactionCreate`:
      filtro `guildId === env.GUILD_ID`, checagem de nível, cooldown,
      `try/catch` que responde efêmero com `UserFacingError` ou embed de
      erro genérico + log; `deferReply` automático se o comando declarar
      `defer: true`.
- [ ] `src/lib/embeds.ts`: `successEmbed`, `errorEmbed`, `infoEmbed` com a
      cor de `general.embedColor` e o prefixo `>` (styleguide §9).
- [ ] Eventos: `ready` (loga, registra comandos), `interactionCreate`,
      `guildCreate`/`guildDelete` (upsert em `guilds`), `error`,
      `shardDisconnect`.
- [ ] Comandos: `/ping` (gateway, REST, DB), `/help` (lista por módulo,
      respeitando nível), `/config reload` (admin: invalida cache).
- [ ] `src/index.ts`: boot → env → db → client → loader → login; graceful
      shutdown (SIGINT/SIGTERM).
- [ ] `tsup.config.ts` (`format: esm`, `target: node22`, `noExternal:
    [/^@cobot\//]`).
- [ ] Testes unitários: `resolveLevel`, `canActOn` (mocks simples de
      `GuildMember`), hash do registry estável.

**Arquivos criados/alterados:** `apps/bot/src/**`, `apps/bot/tsup.config.ts`,
`packages/db/src/repositories/meta.ts`.

**Critérios de aceite:**

- `pnpm --filter @cobot/bot dev` conecta, loga `ready` com o nome do bot e
  registra os 3 comandos (segunda execução: "comandos inalterados").
- `/ping` responde com as três latências; `/help` lista por módulo;
  `/config reload` só funciona para admin (mod recebe erro efêmero).
- Comando com exceção não derruba o processo e responde erro efêmero.

**Comandos de validação:**

```bash
pnpm --filter @cobot/bot dev      # testar /ping, /help, /config reload no Discord
pnpm lint && pnpm typecheck && pnpm test && pnpm build
node apps/bot/dist/index.js       # build roda igual ao dev
```

▶ Etapa concluída. Rode /clear antes de iniciar a próxima etapa para limpar o contexto.

---

## Etapa 4 — Moderação e casos

**Contexto mínimo para esta etapa:** `CLAUDE.md`, `.harness/prd.md` §5.1,
§7.4, §9.1, `.harness/styleguide.md` §9, esta etapa, `apps/bot/src/lib/
command.ts`, `apps/bot/src/lib/interaction.ts`, `apps/bot/src/lib/embeds.ts`,
`apps/bot/src/services/permissions.ts`, `apps/bot/src/services/config.ts`,
`packages/db/src/schema/cases.ts`, `packages/db/src/repositories/cases.ts`,
`packages/shared/src/config/moderation.ts`, `packages/shared/src/duration.ts`.

**Objetivo:** todos os comandos de moderação, criação/consulta/edição de
casos, DM ao punido, scheduler de tempban/timeout, escalada de warns, menu de
contexto "Punir…". O mod-log fica para a Etapa 5 (aqui só um `ModlogService`
stub com `postCase(case)` vazio).

**Pré-requisitos:** Etapas 1–3.

**Tarefas:**

- [ ] `src/services/moderation.ts`: `ModerationService` com um método por
      ação (`ban`, `tempban`, `unban`, `softban`, `kick`, `timeout`,
      `untimeout`, `warn`, `note`) — cada um: valida hierarquia
      (`canActOn`), executa no Discord, cria caso (`cases` repo), agenda
      `scheduled_actions` se houver duração, envia DM (se config), chama
      `modlog.postCase`. Recebe `{ guild, actor, target, reason, duration,
    source }` para ser reutilizado pela API interna e pelo automod.
- [ ] `src/services/dm.ts`: `sendPunishmentDm(user, case, template)`
      tolerante a DM fechada.
- [ ] `src/services/scheduler.ts`: loop de 30s em `scheduled_actions` com
      `run_at <= now() and done_at is null` (`FOR UPDATE SKIP LOCKED`),
      executa `unban`/`untimeout` com `actor = bot`, marca `done_at`.
- [ ] `src/services/escalation.ts`: após `warn`, conta warns na janela da
      config e aplica a ação configurada (cria caso `source: escalation`).
- [ ] Comandos: `/ban`, `/unban`, `/softban`, `/kick`, `/timeout`,
      `/untimeout`, `/warn`, `/note`, `/reason`, `/case view|edit|delete`,
      `/history` (paginação com botões `◀ ▶`, expira em 2 min), user
      context menu `Punir…` (modal: tipo select + motivo + duração).
- [ ] `src/lib/case-embed.ts`: embed de caso (styleguide §9: cor por tipo,
      rodapé `CASO #n · MOD: x`).
- [ ] Repositório `cases.ts`: `create`, `getByNumber`, `listByTarget`
      (paginado), `update`, `softDelete`, `countWarnsSince`.
- [ ] Testes: `escalation` (janelas), `case-embed` (cores por tipo),
      `ModerationService` com Discord mockado (hierarquia recusada, caso
      criado com `expires_at` correto).

**Arquivos criados/alterados:** `apps/bot/src/commands/moderation/*.ts`,
`apps/bot/src/services/{moderation,dm,scheduler,escalation,modlog}.ts`,
`apps/bot/src/lib/case-embed.ts`, `packages/db/src/repositories/cases.ts`.

**Critérios de aceite:**

- Cada comando cria o caso correto com número sequencial por guild.
- `/timeout` de 1 min é desfeito automaticamente e gera caso `UNTIMEOUT`
  com `actor = bot` em até 30s após expirar.
- Tentar punir alguém com cargo superior retorna erro efêmero sem criar caso.
- `/history @user` pagina; `/case edit` altera motivo e registra `edited_by`.
- 3 warns em 1h com escalada configurada para `timeout 10m` aplicam o
  timeout.

**Comandos de validação:**

```bash
pnpm --filter @cobot/bot dev   # testar os comandos num servidor de teste com uma conta alt
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

▶ Etapa concluída. Rode /clear antes de iniciar a próxima etapa para limpar o contexto.

---

## Etapa 5 — Mod-log e logs de eventos

**Contexto mínimo para esta etapa:** `CLAUDE.md`, `.harness/prd.md` §5.4,
§7.4, `.harness/styleguide.md` §9, esta etapa, `apps/bot/src/services/
modlog.ts` (stub), `apps/bot/src/services/moderation.ts` (só assinaturas),
`apps/bot/src/lib/event.ts`, `apps/bot/src/lib/case-embed.ts`,
`packages/shared/src/config/logs.ts`, `packages/db/src/schema/messages.ts`,
`packages/db/src/schema/configs.ts` (`log_configs`).

**Objetivo:** fila de envio de logs com coalescing, mod-log real (post e
edição de mensagem do caso), e todos os logs de mensagens/membros/servidor/
voice com canais e ignorados configuráveis, mais `message_cache`.

**Pré-requisitos:** Etapas 1–4.

**Tarefas:**

- [ ] `src/services/log-queue.ts`: fila por canal, junta até 10 embeds por
      mensagem, flush a cada 2s ou quando cheia, backoff em 429, descarta
      com log de warn se o canal não existe/sem permissão.
- [ ] `src/services/modlog.ts`: `postCase` (envia, salva
      `modlog_message_id`), `updateCase` (edita a mensagem quando o motivo
      muda), `postAction` (lock/purge/raid).
- [ ] `src/services/logs.ts`: `LogService.emit(guildId, kind, embed)` que
      resolve canal por `log_configs` (com fallback ao canal geral) e
      ignorados; helpers de formato (diff de antes/depois com truncamento em
      1024 chars).
- [ ] `src/services/message-cache.ts`: grava em `message_cache` em lote
      (buffer de 100 ou 5s) quando o módulo de logs está ativo; job de
      limpeza (7 dias) a cada hora.
- [ ] Eventos: `messageUpdate`, `messageDelete`, `messageDeleteBulk` (anexa
      `.txt`), `guildMemberAdd`, `guildMemberRemove`, `guildMemberUpdate`
      (nick, cargos — com `fetchAuditLogs` para descobrir o autor, timeout de
      2s), `guildBanAdd/Remove` (só quando não veio do bot — evitar
      duplicar caso), `channelCreate/Update/Delete`, `roleCreate/Update/
    Delete`, `emojiCreate/Delete`, `guildUpdate`, `voiceStateUpdate`.
- [ ] Comando `/logs status` (mod): mostra a grade tipo → canal → ativo.
- [ ] Testes: coalescing da fila (10 embeds → 1 envio), resolução de canal
      com fallback e ignorados, formatação de diff.

**Arquivos criados/alterados:** `apps/bot/src/services/{log-queue,modlog,logs,
message-cache}.ts`, `apps/bot/src/events/logs/*.ts`,
`apps/bot/src/commands/moderation/logs.ts`.

**Critérios de aceite:**

- Caso criado aparece no canal de mod-log; `/case edit` edita a mensagem.
- Editar/apagar mensagem gera log com antes/depois; apagar mensagem
  enviada antes do bot subir mostra conteúdo (via `message_cache`).
- Entrar/sair, mudar nick, mudar cargo (com "por: @mod"), criar canal,
  entrar em voice geram logs nos canais configurados.
- Apagar 50 mensagens em 1s gera ≤ 5 mensagens de log (coalescing).

**Comandos de validação:**

```bash
pnpm --filter @cobot/bot dev
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

▶ Etapa concluída. Rode /clear antes de iniciar a próxima etapa para limpar o contexto.

---

## Etapa 6 — Automod

**Contexto mínimo para esta etapa:** `CLAUDE.md`, `.harness/prd.md` §5.2,
§7.3 (ReDoS), esta etapa, `packages/shared/src/config/automod-rule.ts`,
`packages/shared/src/config/automod.ts`, `packages/db/src/schema/automod.ts`,
`apps/bot/src/services/moderation.ts` (assinaturas), `apps/bot/src/services/
modlog.ts` (assinaturas), `apps/bot/src/services/config.ts`.

**Objetivo:** motor de automod com todas as regras do PRD §5.2, ações
configuráveis, anti-raid com modo manual, registro de hits.

**Pré-requisitos:** Etapas 1–5.

**Tarefas:**

- [ ] `src/automod/engine.ts`: carrega regras da guild (cache invalidável
      por `ConfigBus` no módulo `automod`), ordena por prioridade, avalia
      allowlists, roda `rule.check(ctx)` → `Violation | null`, executa
      `actions` em ordem (`delete` primeiro), grava `automod_hits`,
      incrementa stats (hook vazio até a Etapa 10).
- [ ] `src/automod/rules/*.ts`, uma por tipo, implementando a interface
      `Rule { type, check(ctx, config) }`:
      `spam` (janela deslizante por usuário/canal em memória + duplicatas),
      `links` (extração de URLs, allowlist de domínios, detecção de convite
      `discord.gg|discord.com/invite`), `caps`, `words` (exata/wildcard/
      regex com `safe-regex2` + `RegExp` compilada uma vez + timeout via
      limite de tamanho da mensagem), `mentions` (usuários + cargos +
      everyone), `raid` (contador de joins em janela; entra em modo raid;
      ação em `guildMemberAdd`).
- [ ] `src/automod/actions.ts`: mapeia `AutomodAction` → chamada de
      `ModerationService` com `source: 'automod'`, `dm_user`,
      `notify_modlog`.
- [ ] `src/automod/raid.ts`: estado do modo raid por guild (`until`,
      `mode`), `/raid on [minutos]|off|status` (admin), alerta no mod-log.
- [ ] Eventos: `messageCreate`, `messageUpdate` (re-avalia), `guildMemberAdd`
      (raid + idade da conta).
- [ ] Comandos: `/automod list`, `/automod toggle <regra>`, `/automod test
    <regra> <texto>` (retorna se dispararia) — admin.
- [ ] Job: limpeza de `automod_hits` > 30 dias.
- [ ] Testes: cada regra com casos positivos/negativos; regex perigosa
      rejeitada; spam em janela; raid entra e sai do modo.

**Arquivos criados/alterados:** `apps/bot/src/automod/**`,
`apps/bot/src/events/automod/*.ts`, `apps/bot/src/commands/automod/*.ts`,
`packages/db/src/repositories/automod.ts`.

**Critérios de aceite:**

- Regra `links` com ação `delete + warn` apaga o link e cria caso `WARN`
  com `source: automod` e `automod_rule_id`.
- Cargo isento não é afetado.
- 6 mensagens em 3s disparam `spam`; 5 não.
- `/raid on 10` faz o próximo join ser kickado com log; `/raid off` volta.
- `/automod test words "palavra"` responde corretamente.

**Comandos de validação:**

```bash
pnpm --filter @cobot/bot dev
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

▶ Etapa concluída. Rode /clear antes de iniciar a próxima etapa para limpar o contexto.

---

## Etapa 7 — Utilidades

**Contexto mínimo para esta etapa:** `CLAUDE.md`, `.harness/prd.md` §5.3,
§7.4 (purge), esta etapa, `apps/bot/src/lib/command.ts`, `apps/bot/src/lib/
embeds.ts`, `apps/bot/src/services/modlog.ts` (assinaturas),
`apps/bot/src/services/scheduler.ts`, `packages/db/src/schema/misc.ts`,
`packages/shared/src/config/utilities.ts`.

**Objetivo:** todos os comandos utilitários do PRD §5.3, com lembretes e
polls persistidos e agendados pelo scheduler existente.

**Pré-requisitos:** Etapas 1–6.

**Tarefas:**

- [ ] `/purge` com todos os filtros; `bulkDelete` em lotes de 100 para ≤14
      dias; resto individual com delay 1s e progresso na resposta efêmera;
      log no mod-log com contagem e filtros.
- [ ] `/slowmode`, `/lock`, `/unlock`, `/lockdown` (salva overrides
      anteriores em `scheduled_actions.payload` ou tabela `channel_locks`
      simples para restaurar exatamente; adicionar migration se necessário).
- [ ] `/userinfo`, `/serverinfo`, `/avatar`, `/roleinfo` (embeds
      styleguide §9; `userinfo` inclui contagem de casos por tipo).
- [ ] `/remind set|list|cancel` usando `reminders` + `scheduler` (novo
      `kind: reminder`).
- [ ] `/poll create` (botões, 2–10 opções, múltipla escolha, duração),
      handler de botão que grava voto em `polls.votes`, `poll_close` no
      scheduler que edita a mensagem com resultado em barras de texto
      (`████░░ 67%`).
- [ ] Comando `/help` atualizado automaticamente (já lista por módulo).
- [ ] Testes: parser de filtros do purge, cálculo de resultado do poll,
      formatação de barras.

**Arquivos criados/alterados:** `apps/bot/src/commands/utilities/*.ts`,
`apps/bot/src/interactions/poll-buttons.ts`, `apps/bot/src/services/
scheduler.ts` (novos kinds), `packages/db/src/repositories/{reminders,polls}.ts`,
possível migration `0001_channel_locks`.

**Critérios de aceite:**

- `/purge 120 user:@x` apaga só as do usuário, informa quantas, loga.
- `/lock` + `/unlock` restaura exatamente os overrides anteriores.
- `/remind set 1m teste` envia DM em ~1 min; sobrevive a restart do bot.
- `/poll` encerra sozinho e mostra resultado; não aceita voto após fechar.

**Comandos de validação:**

```bash
pnpm --filter @cobot/bot dev
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

▶ Etapa concluída. Rode /clear antes de iniciar a próxima etapa para limpar o contexto.

---

## Etapa 8 — Comunidade I: boas-vindas, autorole, tags

**Contexto mínimo para esta etapa:** `CLAUDE.md`, `.harness/prd.md` §5.5
(itens boas-vindas, autorole, tags), esta etapa, `packages/shared/src/
templates.ts`, `packages/shared/src/config/{welcome,autorole,tags}.ts`,
`packages/db/src/schema/community.ts` (partes welcome/autorole/tags),
`apps/bot/src/lib/command.ts`, `apps/bot/src/lib/embeds.ts`,
`apps/bot/src/services/config.ts`.

**Objetivo:** mensagens de entrada/saída com template e preview, autorole
(humano/bot, atraso, verificação por botão) e tags CRUD com autocomplete.

**Pré-requisitos:** Etapas 1–7.

**Tarefas:**

- [ ] `src/services/welcome.ts`: `guildMemberAdd`/`Remove` → renderiza
      `MessageTemplate` (texto ou embed) com variáveis, envia no canal e DM
      opcional; `/welcome test` (admin) envia para o próprio autor.
- [ ] `src/services/autorole.ts`: aplica cargos ao entrar (separando bots),
      atraso via `setTimeout` (≤10 min) ou `scheduled_actions` (>10 min);
      verificação: `/verify setup` publica mensagem com botão persistente
      (`customId: verify`), handler aplica o cargo.
- [ ] `src/commands/community/tag.ts`: `/tag <nome>` com autocomplete,
      `/tag create|edit|delete|list|info`; permissão de criação por config
      (`tags.createRoleIds`); contador `uses`.
- [ ] `src/interactions/` registrador de handlers de botão/select/modal por
      prefixo de `customId` (usado aqui por `verify` e reaproveitado na
      Etapa 9) — se ainda não existir da Etapa 7, criar agora.
- [ ] Testes: renderização de template (todas as variáveis, escaping de
      menções indevidas), seleção humano/bot no autorole, autocomplete de
      tags (prefixo, limite 25).

**Arquivos criados/alterados:** `apps/bot/src/services/{welcome,autorole}.ts`,
`apps/bot/src/commands/community/{welcome,verify,tag}.ts`,
`apps/bot/src/interactions/{index,verify}.ts`, `packages/db/src/repositories/
{welcome,autorole,tags}.ts`.

**Critérios de aceite:**

- Conta alt entra → mensagem de boas-vindas com `{memberCount}` correto e
  cargo de autorole aplicado; sai → mensagem de saída.
- Botão de verificação dá o cargo e responde efêmero; clicar de novo diz que
  já tem.
- `/tag` autocompleta; membro sem permissão não cria; `uses` incrementa.

**Comandos de validação:**

```bash
pnpm --filter @cobot/bot dev
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

▶ Etapa concluída. Rode /clear antes de iniciar a próxima etapa para limpar o contexto.

---

## Etapa 9 — Comunidade II: reaction roles, tickets

**Contexto mínimo para esta etapa:** `CLAUDE.md`, `.harness/prd.md` §5.5
(reaction roles, tickets), esta etapa, `packages/shared/src/config/
{reactionRoles,tickets}.ts`, `packages/db/src/schema/community.ts` (partes
reaction_role_* e ticket_*), `apps/bot/src/interactions/index.ts`,
`apps/bot/src/lib/command.ts`, `apps/bot/src/services/logs.ts`
(assinatura de `emit`).

**Objetivo:** painéis de reaction roles (botões/select/reações) publicáveis e
sistema de tickets completo com transcript.

**Pré-requisitos:** Etapas 1–8.

**Tarefas:**

- [ ] `src/services/reaction-roles.ts`: `publishPanel(panelId)` monta a
      mensagem (embed + componentes conforme `style`), envia ou edita,
      salva `message_id`; handlers `rr:<panelId>:<itemId>` (botão) e
      `rr:<panelId>` (select) aplicando `mode` (single remove os outros do
      painel; toggle; multiple); `messageReactionAdd/Remove` para `style:
    reactions` (partials).
- [ ] `/reactionrole create|add|remove|publish|list` (admin) — versão
      mínima por comando; o editor completo é o painel (Etapa 15).
- [ ] `src/services/tickets.ts`: `publishPanel`, `open(typeId, user)`
      (limite por usuário, cria canal na categoria com overrides: usuário +
      cargos de suporte; nome pelo `naming_pattern`; mensagem de abertura com
      botões `Fechar`/`Assumir`), `claim`, `add/remove user`, `rename`,
      `close(reason)` (gera transcript, envia ao canal de log e DM, apaga
      canal após 10s).
- [ ] `src/services/transcript.ts`: HTML simples e autocontido (estilo
      styleguide §9 em CSS inline, sem assets externos) + `.txt`; salvo como
      anexo no canal de log (a URL do anexo vira `transcript_url`).
- [ ] `/ticket close|add|remove|claim|rename` e `/ticket panel publish`.
- [ ] Handlers de botão `ticket:open:<typeId>`, `ticket:close`,
      `ticket:claim`, modal de motivo ao fechar.
- [ ] Testes: lógica de `mode` do reaction role (single/multiple/toggle),
      `naming_pattern`, geração de transcript (escapa HTML).

**Arquivos criados/alterados:** `apps/bot/src/services/{reaction-roles,tickets,
transcript}.ts`, `apps/bot/src/commands/community/{reactionrole,ticket}.ts`,
`apps/bot/src/interactions/{reaction-roles,tickets}.ts`,
`packages/db/src/repositories/{reactionRoles,tickets}.ts`.

**Critérios de aceite:**

- Painel `single` com 3 cargos: clicar em dois deixa só o último.
- Painel `reactions` funciona após restart (partials).
- Abrir ticket cria canal privado visível só para autor + suporte; segundo
  ticket acima do limite é recusado; fechar gera transcript no log, DM ao
  autor e apaga o canal.

**Comandos de validação:**

```bash
pnpm --filter @cobot/bot dev
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

▶ Etapa concluída. Rode /clear antes de iniciar a próxima etapa para limpar o contexto.

---

## Etapa 10 — Coleta de estatísticas

**Contexto mínimo para esta etapa:** `CLAUDE.md`, `.harness/prd.md` §5.6,
§7.2, esta etapa, `packages/db/src/schema/stats.ts`, `packages/shared/src/
constants.ts` (`STAT_KINDS`), `apps/bot/src/automod/engine.ts` (só o hook
de stats), `apps/bot/src/services/moderation.ts` (só onde criar o hook),
`apps/bot/src/lib/interaction.ts`, `apps/bot/src/services/tickets.ts`
(assinaturas de open/close).

**Objetivo:** `StatsService` com agregação em memória e flush em lote, hooks
em todos os pontos de evento, job de rollup diário e retenção, e as queries
de leitura que o painel vai usar.

**Pré-requisitos:** Etapas 1–9.

**Tarefas:**

- [ ] `src/services/stats.ts`: `increment(guildId, kind, key, amount = 1)`
      agrega em `Map<bucketKey, count>` por hora; `flush()` a cada 60s com
      `INSERT … ON CONFLICT DO UPDATE SET count = count + excluded.count`;
      flush no shutdown.
- [ ] Hooks: `messageCreate` (canal, usuário/dia), `guildMemberAdd/Remove`,
      `voiceStateUpdate` (minutos por canal — calcular por sessão em
      memória), criação de caso (por tipo), automod hit (por regra),
      comando executado (por nome), ticket open/close.
- [ ] Snapshot diário `members_total` (à meia-noite no TZ da guild + no
      boot se o dia ainda não tem).
- [ ] Job noturno: rollup hora → dia para buckets > 90 dias, delete dos
      horários agregados.
- [ ] `packages/db/src/repositories/stats.ts` (queries de leitura, todas
      parametrizadas por `guildId` e período): `messagesPerDay`,
      `membersGrowth`, `heatmapHourWeekday`, `topChannels`, `topUsers`,
      `casesByType`, `automodByRule`, `commandsUsage`, `ticketsPerDay`,
      `summary` (números dos stat tiles com delta).
- [ ] `/stats` (mod): embed resumo de 7 dias.
- [ ] Testes: agregação em memória (mesma hora soma, hora diferente separa),
      rollup (soma correta), queries com dados fixture no Postgres de dev.

**Arquivos criados/alterados:** `apps/bot/src/services/stats.ts`,
`apps/bot/src/jobs/stats-rollup.ts`, `packages/db/src/repositories/stats.ts`,
`apps/bot/src/commands/utilities/stats.ts`, hooks espalhados.

**Critérios de aceite:**

- Enviar 20 mensagens → após ≤60s, `stat_buckets` tem `messages_channel`
  com `count = 20` na hora atual (um único registro).
- Nenhum `INSERT` em `stat_buckets` fora do flush (checar com log de query
  em dev).
- `/stats` mostra números coerentes.

**Comandos de validação:**

```bash
pnpm --filter @cobot/bot dev
docker compose -f infra/docker-compose.dev.yml exec postgres psql -U cobot -d cobot -c "select kind,key,bucket_start,count from stat_buckets order by bucket_start desc limit 20"
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

▶ Etapa concluída. Rode /clear antes de iniciar a próxima etapa para limpar o contexto.

---

## Etapa 11 — API interna do bot (Hono)

**Contexto mínimo para esta etapa:** `CLAUDE.md`, `.harness/prd.md` §5.7,
§7.3 (API interna), §7.4, esta etapa, `packages/shared/src/api/*.ts`,
`apps/bot/src/services/{moderation,config,reaction-roles,tickets,welcome}.ts`
(só assinaturas públicas), `apps/bot/src/index.ts`, `.env.example`.

**Objetivo:** servidor Hono dentro do processo do bot com todos os endpoints
do PRD §5.7, autenticação por token, validação Zod, rate limit e um client
tipado em `packages/shared` para o painel consumir.

**Pré-requisitos:** Etapas 1–10.

**Tarefas:**

- [ ] `src/api/server.ts`: Hono + `@hono/node-server` em
      `INTERNAL_API_PORT` (3001), bind `0.0.0.0` (a rede do Compose isola),
      middlewares: `requestId`, logger pino, auth Bearer com
      `crypto.timingSafeEqual`, body limit 256 KB, rate limit em memória
      (100 req/min por rota), handler de erro que mapeia
      `UserFacingError` → 400, `DiscordAPIError` 429 → 503 + `retryAfter`,
      resto → 500 sem vazar stack.
- [ ] `src/api/routes/*.ts`: `health`, `guild` (channels/roles/members/
      member/audit-log), `moderation` (POST → `ModerationService` com
      `source: 'dashboard'` e `actorId` validado como membro com nível ≥
      mod), `config` (invalidate → `ConfigBus.publish`), `messages`
      (welcome test, publish de painéis).
- [ ] `zValidator` do Hono com os schemas de `@cobot/shared/api`.
- [ ] `packages/shared/src/api/client.ts`: `createInternalClient({ baseUrl,
    token })` com uma função por endpoint, tipada pelos mesmos schemas,
      `fetch` nativo, timeout 10s, erro tipado `InternalApiError`.
- [ ] Boot/shutdown do servidor em `src/index.ts`.
- [ ] Testes: auth (sem token 401, token errado 401, certo 200), validação
      (body inválido 400), `moderation` chama o serviço com `source:
    dashboard` (serviço mockado), 429 → 503.

**Arquivos criados/alterados:** `apps/bot/src/api/**`,
`packages/shared/src/api/client.ts`, `apps/bot/src/index.ts`.

**Critérios de aceite:**

- `curl -H "Authorization: Bearer $INTERNAL_API_TOKEN"
localhost:3001/health` retorna JSON com `gateway: ready`.
- `POST /guilds/:id/moderation` com `type: warn` cria caso e mod-log iguais
  ao comando, com `source = dashboard`.
- `POST /guilds/:id/config/invalidate` faz o bot recarregar config (visível
  no log).
- Token não aparece em nenhum log.

**Comandos de validação:**

```bash
pnpm --filter @cobot/bot dev
curl -s -H "Authorization: Bearer $INTERNAL_API_TOKEN" localhost:3001/health | jq
curl -s -o /dev/null -w "%{http_code}\n" localhost:3001/health   # 401
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

▶ Etapa concluída. Rode /clear antes de iniciar a próxima etapa para limpar o contexto.

---

## Etapa 12 — Esqueleto do painel (Next.js, Auth.js, layout, 2 temas)

**Contexto mínimo para esta etapa:** `CLAUDE.md`, `.harness/prd.md` §6
(intro), §7.1, §7.3 (OAuth, web), §9.2, **`.harness/styleguide.md`
inteiro**, esta etapa, `apps/web/package.json`, `apps/web/app/layout.tsx`,
`packages/shared/src/api/client.ts` (assinatura), `packages/db/src/index.ts`,
`packages/db/src/repositories/audit.ts`, `.env.example`.

**Objetivo:** painel com login Discord, verificação de permissão via API
interna, layout (sidebar, topbar, breadcrumb), os dois temas do styleguide
funcionando com toggle sem flash, componentes shadcn tematizados, helper de
autorização e helper de auditoria prontos para as próximas etapas.

**Pré-requisitos:** Etapas 1–11.

**⚠️ AÇÃO MANUAL (antes de codar):**

1. Discord Developer Portal → aplicação → _OAuth2_ → _Redirects_: adicionar
   `http://localhost:3000/api/auth/callback/discord` (e depois a URL de
   produção na Etapa 19). Copiar _Client Secret_ para
   `DISCORD_CLIENT_SECRET`.
2. Gerar `AUTH_SECRET` com `openssl rand -base64 32`; `AUTH_URL=
http://localhost:3000`.

**Tarefas:**

- [ ] `app/globals.css` conforme styleguide §7: `--palette-*`, blocos
      `[data-theme='crimson']`/`[data-theme='rose']`, aliases shadcn,
      `@theme inline` com JetBrains Mono (`@fontsource-variable` ou
      `@fontsource/jetbrains-mono` pesos 400/500/700/800 + itálicos),
      utilities `retro-border`, `retro-shadow(-sm)`, `terminal-cursor`,
      `terminal-scanline`, `animate-enter`, `btn-goodchat*`, `screen-pad`,
      foco, `::selection`, `prefers-reduced-motion`.
- [ ] `pnpm dlx shadcn@latest init` + `add` de: button, input, textarea,
      select, switch, checkbox, radio-group, label, form, table, card,
      dialog, alert-dialog, sheet, dropdown-menu, command, popover, tooltip,
      tabs, badge, separator, skeleton, sonner, pagination, breadcrumb,
      sidebar, scroll-area. Editar cada um em `components/ui/*` para
      radius 0, borda 2px, sombra dura, tipografia do styleguide §6.
- [ ] `components/theme/{theme-script,theme-provider,theme-toggle}.tsx`:
      script inline no `<head>` (nonce) que lê `localStorage.cobot-theme`
      ou `prefers-color-scheme` e seta `data-theme`; toggle na topbar;
      atalho `Shift+T`.
- [ ] Auth.js v5: `auth.ts` (provider Discord, scopes `identify guilds
    guilds.members.read`, JWT), `app/api/auth/[...nextauth]/route.ts`,
      callback `jwt` que na primeira vez chama a API interna
      (`GET /guilds/:id/members/:userId`) para resolver `level`
      (`owner|admin|mod|none`) e guarda no token com `checkedAt`;
      `session` expõe `user.id`, `level`, `guildId`.
- [ ] `lib/auth/require.ts`: `requireGuildAccess(level)` para server
      components/actions/route handlers; re-verifica se `checkedAt` > 15
      min; `redirect('/denied')` ou `throw`.
- [ ] `lib/internal-api.ts`: instancia o client de `@cobot/shared` com
      `INTERNAL_API_URL` + token (server-only).
- [ ] `lib/db.ts`: client Drizzle (server-only, singleton).
- [ ] `lib/audit.ts`: `withAudit(action, target, before, after)` usando
      `appendAudit` + IP/UA de `headers()`.
- [ ] Rotas: `/login` (screen-title, botão `ENTRAR COM DISCORD`),
      `/denied`, `/g/[guildId]/layout.tsx` (sidebar §6.9 com grupos e itens
      de todas as páginas futuras, topbar com breadcrumb/status do bot/
      toggle/avatar+sair), `/g/[guildId]/page.tsx` placeholder "Dashboard"
      com 4 `stat-tile` de exemplo, `/` redireciona para
      `/g/${GUILD_ID}`.
- [ ] `middleware.ts`: protege `/g/*`.
- [ ] Componentes base do styleguide: `Panel` (com `window-bar` +
      `WindowDots`), `ScreenHeader` (kicker/title/meta), `StatTile`,
      `EmptyState`, `ErrorState`, `PageSkeleton`, `Tag`, `AvatarSq`,
      `PresenceDot`, `BotStatusBanner` (usa `/health` com `revalidate: 30`).
- [ ] CSP em `next.config.ts` headers (self, nonce no script de tema).
- [ ] `next.config.ts`: `output: 'standalone'`, `transpilePackages:
    ['@cobot/shared', '@cobot/db']`.
- [ ] Testes: `requireGuildAccess` (níveis), `renderização do Panel/StatTile`
      (Vitest + Testing Library, `jsdom`).

**Arquivos criados/alterados:** `apps/web/app/**`, `apps/web/components/**`,
`apps/web/lib/**`, `apps/web/auth.ts`, `apps/web/middleware.ts`,
`apps/web/next.config.ts`, `apps/web/app/globals.css`.

**Critérios de aceite:**

- Login com conta admin do servidor entra; conta sem permissão cai em
  `/denied`; conta fora do servidor idem.
- Toggle alterna `crimson`/`rose` sem flash ao recarregar; ambos os temas
  batem com o styleguide (bordas 2px `base-300`, sombra dura, radius 0 em
  botão, input, dialog, badge, switch).
- Sidebar/topbar responsivos (sheet abaixo de `lg`).
- Bot desligado → banner `BOT OFFLINE` aparece.
- `pnpm --filter @cobot/web build` sem erros de tipo/CSP.

**Comandos de validação:**

```bash
pnpm --filter @cobot/bot dev &    # a API interna precisa estar de pé
pnpm --filter @cobot/web dev      # abrir http://localhost:3000
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

▶ Etapa concluída. Rode /clear antes de iniciar a próxima etapa para limpar o contexto.

---

## Etapa 13 — Dashboard de estatísticas

**Contexto mínimo para esta etapa:** `CLAUDE.md`, `.harness/prd.md` §6.1,
`.harness/styleguide.md` §6.7, §8, esta etapa, `packages/db/src/repositories/
stats.ts` (assinaturas), `apps/web/app/g/[guildId]/page.tsx`,
`apps/web/components/{panel,stat-tile,empty-state,error-state,page-skeleton}.tsx`,
`apps/web/lib/{db,auth/require}.ts`, `apps/web/components/ui/chart.tsx`.

**Objetivo:** dashboard completo do PRD §6.1 com seletor de período, gráficos
Recharts tematizados, heatmap, atividade recente, estados de loading/vazio/
erro.

**Pré-requisitos:** Etapas 1–12.

**Tarefas:**

- [ ] `pnpm dlx shadcn@latest add chart` (Recharts) e tematizar conforme
      styleguide §6.7 (`type="linear"`, grid horizontal, sem animação, cores
      `--chart-1..5`, tooltip com moldura).
- [ ] `lib/stats.ts`: funções server-side que chamam o repositório com
      `guildId` + período parseado de `searchParams` (`?range=7d|30d|90d|
    from,to`), `unstable_cache` de 60s por chave.
- [ ] `components/charts/`: `MessagesPerDay` (linha atual vs anterior),
      `MembersGrowth` (área), `ActivityHeatmap` (grid CSS, 5 degraus),
      `TopChannels` (barras horizontais), `CasesByType` (barras empilhadas),
      `AutomodByRule` (barras), `Sparkline`.
- [ ] `components/period-picker.tsx` (tags 7D/30D/90D + popover com
      `calendar` para custom; atualiza `searchParams`).
- [ ] Página: 6 stat tiles com delta e sparkline, grade de gráficos,
      listas "últimos casos" e "última auditoria" (links para as páginas
      das Etapas 17), tudo em `Suspense` com `PageSkeleton` por bloco e
      `error.tsx` com `ErrorState`.
- [ ] Tratamento de vazio (servidor novo): `EmptyState` `> AINDA SEM DADOS`
      por gráfico.
- [ ] Testes: parser de `range`, transformação de buckets → séries
      (preenche dias sem dado com 0), cálculo de delta.

**Arquivos criados/alterados:** `apps/web/app/g/[guildId]/page.tsx`,
`apps/web/app/g/[guildId]/{loading,error}.tsx`, `apps/web/components/charts/*`,
`apps/web/components/period-picker.tsx`, `apps/web/lib/stats.ts`.

**Critérios de aceite:**

- Dashboard mostra dados reais do bot de dev; mudar período atualiza tudo.
- Gráficos em ambos os temas obedecem o styleguide (nenhuma curva suave,
  nenhum gradiente, tooltip com moldura 2px).
- Sem dados → estados vazios; API/DB fora → `ErrorState` com botão de
  retry.
- Lighthouse de performance ≥ 80 em dev build (`pnpm build && pnpm start`).

**Comandos de validação:**

```bash
pnpm dev                    # bot + web
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

▶ Etapa concluída. Rode /clear antes de iniciar a próxima etapa para limpar o contexto.

---

## Etapa 14 — Configuração I: geral, moderação, logs, boas-vindas, autorole, tags

**Contexto mínimo para esta etapa:** `CLAUDE.md`, `.harness/prd.md` §6.2
(itens Geral, Moderação, Logs, Boas-vindas, Autorole, Tags), `.harness/
styleguide.md` §6.4, §6.5, §6.8, §8, esta etapa, `packages/shared/src/config/
{general,moderation,logs,welcome,autorole,tags}.ts`, `packages/shared/src/
templates.ts`, `packages/db/src/repositories/{configs,tags}.ts`,
`apps/web/lib/{internal-api,audit,auth/require}.ts`, `apps/web/components/ui/
form.tsx`, `apps/web/components/panel.tsx`.

**Objetivo:** infraestrutura reutilizável de "página de configuração de
módulo" (form + server action + auditoria + invalidate + toast) e as seis
primeiras páginas.

**Pré-requisitos:** Etapas 1–13.

**Tarefas:**

- [ ] `lib/module-config.ts`: `loadModuleConfig(guildId, module)` e server
      action genérica `saveModuleConfig(module, formData)` → valida com
      `MODULE_SCHEMAS[module]`, `requireGuildAccess('admin')`, grava,
      `withAudit`, `internalApi.invalidate(module)`, `revalidatePath`.
- [ ] `components/config/`: `ModuleToggle` (header com switch
      "módulo ativo"), `ConfigForm` (react-hook-form + zodResolver, rodapé
      sticky `SALVAR`/`DESCARTAR` só quando dirty, toast), `DiscordPicker`
      (canal/cargo/membro, single/multi, dados via route handler
      `/api/discord/{channels,roles}` que chama a API interna, cache 60s),
      `DurationInput`, `TemplateEditor` (textarea + variáveis + preview de
      embed renderizado em CSS), `EmbedPreview`.
- [ ] Páginas em `app/g/[guildId]/config/<module>/page.tsx`:
      `general`, `moderation` (escalada de warns como lista editável),
      `logs` (grade tipo × ativo × canal + ignorados), `welcome` (join/
      leave/DM com `TemplateEditor` e botão `ENVIAR TESTE` → API interna),
      `autorole`, `tags` (tabela CRUD com `sheet` de edição — usa
      repositório `tags`, não `module_configs`).
- [ ] Itens da sidebar apontando para as páginas.
- [ ] Testes: `saveModuleConfig` rejeita payload inválido e não grava; grava
      auditoria com before/after; `DiscordPicker` filtra por texto.

**Arquivos criados/alterados:** `apps/web/lib/module-config.ts`,
`apps/web/components/config/*`, `apps/web/app/g/[guildId]/config/{general,
moderation,logs,welcome,autorole,tags}/page.tsx`, `apps/web/app/api/discord/
*/route.ts`.

**Critérios de aceite:**

- Alterar canal de mod-log no painel e criar um caso no Discord: o log vai
  para o novo canal sem reiniciar o bot.
- Formulário inválido mostra erro no campo (styleguide §6.4) e não salva.
- Cada salvamento gera uma linha em `audit_logs` com diff.
- Usuário `mod` vê as páginas em modo leitura (campos `disabled`, sem
  rodapé de salvar).

**Comandos de validação:**

```bash
pnpm dev
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

▶ Etapa concluída. Rode /clear antes de iniciar a próxima etapa para limpar o contexto.

---

## Etapa 15 — Configuração II: automod, reaction roles, tickets, comandos

**Contexto mínimo para esta etapa:** `CLAUDE.md`, `.harness/prd.md` §6.2
(itens Automod, Reaction roles, Tickets, Comandos), `.harness/styleguide.md`
§6.3, §6.4, §6.5, esta etapa, `packages/shared/src/config/{automod,
automod-rule,reactionRoles,tickets,utilities}.ts`, `packages/db/src/
repositories/{automod,reactionRoles,tickets}.ts`, `apps/web/lib/
module-config.ts`, `apps/web/components/config/index.ts` (só exports).

**Objetivo:** as páginas de configuração mais complexas, com tabelas CRUD e
editores em `sheet`, e a página de permissões de comandos.

**Pré-requisitos:** Etapas 1–14.

**Tarefas:**

- [ ] `components/data-table/`: wrapper TanStack Table + shadcn `table`
      conforme styleguide §6.3 (toolbar, seleção, paginação, ordenação,
      estados). Reutilizado nas Etapas 16–17.
- [ ] `automod`: tabela de regras (nome, tipo, ativa, hits 24h, ações,
      prioridade com botões ▲▼), `sheet` de criar/editar com formulário
      dinâmico por `type` (campos específicos + lista de ações com
      `DurationInput`), allowlists globais, card anti-raid com botão
      `ATIVAR MODO RAID` (API interna) e status.
- [ ] `reaction-roles`: lista de painéis; editor: canal, `TemplateEditor`,
      modo, estilo, itens (emoji picker simples por texto, label, cargo),
      botões `PUBLICAR`/`ATUALIZAR`/`REMOVER` → API interna.
- [ ] `tickets`: tabs `Tipos` (CRUD), `Painel` (canal, embed, tipos,
      publicar), `Configuração` (transcript, log), `Tickets` (tabela
      aberto/fechado com link de transcript e botão `FECHAR` → API interna).
- [ ] `commands`: tabela de comandos (lida do manifesto exposto por
      `GET /commands` na API interna — adicionar endpoint), por comando:
      ativo, cargos permitidos, canais permitidos/negados; salvo em
      `module_configs.utilities.commandOverrides`; bot lê no
      `interaction.ts` (ajuste pequeno no bot).
- [ ] Testes: form dinâmico do automod gera payload válido para cada tipo;
      reordenação de prioridade; tabela pagina/ordena.

**Arquivos criados/alterados:** `apps/web/components/data-table/*`,
`apps/web/app/g/[guildId]/config/{automod,reaction-roles,tickets,commands}/**`,
`apps/bot/src/api/routes/commands.ts`, `apps/bot/src/lib/interaction.ts`
(overrides).

**Critérios de aceite:**

- Criar regra `links` no painel e enviar link no Discord → apagado, sem
  restart.
- Publicar painel de reaction roles pelo painel → mensagem aparece e
  funciona.
- Desativar `/poll` para o cargo X no painel → o comando recusa para X.
- Tabelas mostram loading/vazio/erro conforme styleguide §8.

**Comandos de validação:**

```bash
pnpm dev
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

▶ Etapa concluída. Rode /clear antes de iniciar a próxima etapa para limpar o contexto.

---

## Etapa 16 — Gestão do servidor: membros, cargos, canais

**Contexto mínimo para esta etapa:** `CLAUDE.md`, `.harness/prd.md` §6.3,
§9.2, `.harness/styleguide.md` §6.3, §6.5, esta etapa, `packages/shared/src/
api/*.ts`, `packages/shared/src/api/client.ts`, `apps/web/components/
data-table/index.ts`, `apps/web/lib/{internal-api,audit,auth/require}.ts`,
`packages/db/src/repositories/cases.ts` (assinaturas).

**Objetivo:** páginas de membros (busca, detalhe, punir, cargos, notas),
cargos (CRUD, permissões, posição) e canais (árvore, CRUD, slowmode, lock,
overrides básicos), todas escrevendo via API interna com auditoria.

**Pré-requisitos:** Etapas 1–15.

**Tarefas:**

- [ ] API interna: adicionar endpoints de escrita que faltam —
      `PATCH/POST/DELETE /guilds/:id/roles[/:roleId]`,
      `/channels[/:channelId]`, `POST /members/:userId/roles`,
      `POST /channels/:id/{slowmode,lock,unlock}` — com schemas em
      `shared/api`, checagem de hierarquia por `actorId`, e client tipado.
- [ ] `members`: busca por nome/ID (`GET /members?q=`), tabela; página
      `members/[userId]`: cabeçalho com `AvatarSq`, ids, datas, cargos com
      `DiscordPicker` para adicionar/remover; tabela de casos do membro;
      botões `BAN/KICK/TIMEOUT/WARN/NOTE` abrindo `AlertDialog` com motivo
      (obrigatório) e duração → `internalApi.moderation` → toast; `mod`
      pode punir, só `admin` mexe em cargos.
- [ ] `roles`: tabela (cor como quadrado, membros, posição, badge
      `PERIGOSO` se tiver Administrator/ManageGuild/etc.), `sheet` de
      criar/editar (nome, cor, hoist, mentionable, checklist de permissões
      agrupadas), mover posição (▲▼), deletar com `AlertDialog`.
- [ ] `channels`: árvore por categoria (lista aninhada, sem drag), ações
      por canal: editar (nome, tópico, NSFW, slowmode), lock/unlock,
      deletar; criar canal/categoria; overrides básicos view/send por
      cargo em `sheet`.
- [ ] Tudo passa por `withAudit`.
- [ ] Testes: server actions recusam nível insuficiente; mapeamento de
      permissões perigosas; construção do payload de overrides.

**Arquivos criados/alterados:** `apps/web/app/g/[guildId]/{members,roles,
channels}/**`, `apps/bot/src/api/routes/{roles,channels,members}.ts`,
`packages/shared/src/api/{roles,channels,members}.ts`, client.

**Critérios de aceite:**

- Buscar membro, abrir, aplicar `WARN` pelo painel → caso aparece no
  Discord (mod-log) com `source: dashboard` e o moderador correto.
- Criar cargo pelo painel → aparece no Discord; tentar editar cargo acima
  do bot → erro claro.
- Lock de canal pelo painel → `/unlock` no Discord restaura.
- Toda ação gera auditoria.

**Comandos de validação:**

```bash
pnpm dev
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

▶ Etapa concluída. Rode /clear antes de iniciar a próxima etapa para limpar o contexto.

---

## Etapa 17 — Casos e auditoria do painel

**Contexto mínimo para esta etapa:** `CLAUDE.md`, `.harness/prd.md` §6.4,
§6.5, `.harness/styleguide.md` §6.3, §6.6, esta etapa, `packages/db/src/
repositories/{cases,audit}.ts`, `packages/db/src/schema/{cases,audit}.ts`,
`apps/web/components/data-table/index.ts`, `apps/web/lib/{internal-api,audit,
auth/require}.ts`.

**Objetivo:** página de casos com filtros server-side, detalhe/edição/
desfazer/exportar CSV, e página de auditoria com diff.

**Pré-requisitos:** Etapas 1–16.

**Tarefas:**

- [ ] Repositório `cases.ts`: `search({ guildId, type[], actorId, targetId,
    from, to, source[], q, page, pageSize, sort })` com `count` total;
      `audit.ts`: `search` equivalente.
- [ ] `cases`: tabela com filtros na toolbar (tipo multi, moderador/alvo via
      `DiscordPicker`, período, origem, texto), URL como estado
      (`searchParams`), paginação server-side, `Tag` por tipo (styleguide
      §2.3), export CSV (route handler `text/csv` streaming, máx. 10k
      linhas).
- [ ] `cases/[caseNumber]`: detalhe, editar motivo (`admin`/`mod`), apagar
      (soft, `admin`, `AlertDialog`), `DESFAZER` (unban/untimeout via API
      interna quando aplicável e ainda ativo), link para mensagem do
      mod-log, link para o membro.
- [ ] `audit`: tabela (ator, ação, alvo, data) com filtros; linha expande
      mostrando `before`/`after` como diff JSON (componente simples:
      chaves adicionadas/removidas/alteradas com cores `success`/`error`/
      `warning`).
- [ ] Dashboard: listas "últimos casos"/"última auditoria" agora linkam para
      cá.
- [ ] Testes: `search` com combinações de filtros (fixture no Postgres),
      geração de CSV (escape), diff JSON.

**Arquivos criados/alterados:** `apps/web/app/g/[guildId]/{cases,audit}/**`,
`apps/web/app/api/cases/export/route.ts`, `apps/web/components/json-diff.tsx`,
`packages/db/src/repositories/{cases,audit}.ts`.

**Critérios de aceite:**

- Filtrar por `tipo=BAN` + período retorna só esses; URL compartilhável
  reproduz o filtro.
- Editar motivo pelo painel edita a mensagem do mod-log.
- Export CSV abre no Excel com acentos corretos (BOM UTF-8).
- Auditoria mostra quem mudou o quê, com diff legível.

**Comandos de validação:**

```bash
pnpm dev
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

▶ Etapa concluída. Rode /clear antes de iniciar a próxima etapa para limpar o contexto.

---

## Etapa 18 — Docker Compose + Caddy (linux/arm64)

**Contexto mínimo para esta etapa:** `CLAUDE.md`, `.harness/prd.md` §7.2,
§7.3, §7.5, esta etapa, `package.json` (raiz), `pnpm-workspace.yaml`,
`apps/bot/package.json`, `apps/bot/tsup.config.ts`, `apps/web/package.json`,
`apps/web/next.config.ts`, `packages/db/package.json`, `packages/db/src/
migrate.ts`, `.env.example`, `infra/docker-compose.dev.yml`.

**Objetivo:** Dockerfiles multi-stage arm64 para bot, web e migrate; Compose
de produção com Postgres, bot, web, Caddy (HTTPS automático), healthchecks,
limites de memória, logs rotacionados; tudo testado localmente (build arm64
via buildx/QEMU no WSL).

**Pré-requisitos:** Etapas 1–17.

**Tarefas:**

- [ ] `infra/docker/bot.Dockerfile`: `node:22-alpine` multi-stage
      (`pnpm fetch` com lockfile → build tsup → runtime só com `dist` +
      deps de produção do bot via `pnpm deploy --prod`); usuário não-root;
      `HEALTHCHECK` batendo em `localhost:3001/health` com o token via env.
- [ ] `infra/docker/web.Dockerfile`: multi-stage com `output: standalone`,
      copia `.next/standalone` + `static` + `public`; `HEALTHCHECK` em
      `/api/health` (criar route handler simples).
- [ ] `infra/docker/migrate.Dockerfile` (ou target no bot): roda
      `packages/db` `db:migrate` e sai.
- [ ] `infra/docker-compose.yml` (prod): serviços `postgres` (16-alpine,
      volume, `shared_buffers=128MB`, healthcheck, sem porta publicada),
      `migrate` (depende de postgres healthy), `bot` (depende de migrate
      completed; `mem_limit: 384m`), `web` (idem; `mem_limit: 512m`),
      `caddy` (`caddy:2-alpine`, portas 80/443, volumes `caddy_data`/
      `caddy_config`). Rede interna única; `restart: unless-stopped`;
      `logging: json-file max-size 10m max-file 5`; `env_file: .env`.
- [ ] `infra/Caddyfile`: `{$DOMAIN}` → `reverse_proxy web:3000`, headers de
      segurança (HSTS, X-Content-Type-Options, Referrer-Policy,
      Permissions-Policy), `encode gzip zstd`, log em JSON.
- [ ] `.dockerignore`.
- [ ] `infra/docker-compose.dev.yml` mantido só com Postgres.
- [ ] Scripts raiz: `docker:build` (`docker buildx build --platform
    linux/arm64` das 3 imagens com tags locais), `docker:up`/`docker:down`.
- [ ] Teste local: `docker buildx create --use` (QEMU já vem no Docker
      Desktop) → build das 3 imagens arm64 → `docker compose -f
    infra/docker-compose.yml up` com `DOMAIN=localhost` (Caddy usa
      certificado interno) → login no painel em `https://localhost`.
- [ ] Documentar no README a seção "Rodar em produção localmente".

**Arquivos criados/alterados:** `infra/docker/*.Dockerfile`,
`infra/docker-compose.yml`, `infra/Caddyfile`, `.dockerignore`,
`apps/web/app/api/health/route.ts`, `package.json` (scripts), `README.md`.

**Critérios de aceite:**

- `docker image inspect cobot-bot --format '{{.Architecture}}'` = `arm64`.
- Imagens: bot ≤ 200 MB, web ≤ 250 MB.
- `docker compose -f infra/docker-compose.yml up -d` sobe os 5 serviços
  saudáveis (`docker compose ps` todos `healthy`/`exited (0)` para migrate);
  bot online no Discord; painel acessível via Caddy; `docker stats` dentro
  dos limites.
- Reiniciar o host (`docker compose down && up`) preserva dados.

**Comandos de validação:**

```bash
pnpm docker:build
docker compose -f infra/docker-compose.yml --env-file .env up -d
docker compose -f infra/docker-compose.yml ps
docker compose -f infra/docker-compose.yml logs -f bot --tail 50
docker stats --no-stream
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

▶ Etapa concluída. Rode /clear antes de iniciar a próxima etapa para limpar o contexto.

---

## Etapa 19 — CI/CD (GitHub Actions) e deploy na Oracle

**Contexto mínimo para esta etapa:** `CLAUDE.md`, `.harness/prd.md` §7.2,
§7.3, §11 (build arm64), esta etapa, `infra/docker-compose.yml`,
`infra/docker/*.Dockerfile`, `infra/Caddyfile`, `.env.example`,
`package.json` (raiz).

**Objetivo:** pipeline que roda lint/typecheck/test em PR, e em push na
`main` constrói as imagens arm64, publica no GHCR e faz deploy via SSH na
instância Oracle com `docker compose pull && up -d`.

**Pré-requisitos:** Etapas 1–18. Repositório no GitHub.

**⚠️ AÇÃO MANUAL (o Claude escreve os arquivos; você executa fora):**

1. **Oracle Cloud**: criar instância _VM.Standard.A1.Flex_ (Ubuntu 24.04
   arm64, ex.: 2 OCPU / 12 GB), com chave SSH. Anotar IP público.
2. **Rede Oracle**: na VCN → Security List da subnet → adicionar _Ingress
   Rules_ TCP 80 e 443 de `0.0.0.0/0` (22 já existe). Na instância, o
   Ubuntu da Oracle tem iptables restritivo: rodar
   `sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j
ACCEPT && sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443
-j ACCEPT && sudo netfilter-persistent save`.
3. **DNS**: registro `A` do domínio (ex.: `cobot.seudominio.com`) → IP
   público. Aguardar propagação.
4. **Na instância**: instalar Docker (`curl -fsSL https://get.docker.com |
sh`, `sudo usermod -aG docker ubuntu`), criar `/opt/cobot`, copiar
   `infra/docker-compose.yml`, `infra/Caddyfile` e um `.env` de produção
   (com `DOMAIN`, `AUTH_URL=https://cobot.seudominio.com`, token novo da API
   interna, `AUTH_SECRET` novo, `DATABASE_URL` apontando para `postgres`).
5. **Discord Developer Portal**: adicionar redirect
   `https://cobot.seudominio.com/api/auth/callback/discord`.
6. **GitHub → Settings → Secrets**: `SSH_HOST`, `SSH_USER` (`ubuntu`),
   `SSH_KEY` (privada, só para deploy), `GHCR` usa `GITHUB_TOKEN`. Se o
   pacote GHCR for privado, criar PAT `read:packages` e fazer `docker login
ghcr.io` uma vez na instância.

**Tarefas:**

- [ ] `.github/workflows/ci.yml`: em `pull_request` e `push` (qualquer
      branch): checkout, pnpm (cache), `pnpm install --frozen-lockfile`,
      `lint`, `typecheck`, `test` (com service container Postgres 16 para
      os testes de integração), `build`.
- [ ] `.github/workflows/deploy.yml`: em `push` na `main` (após CI, via
      `workflow_run` ou jobs encadeados): `docker/setup-qemu-action` +
      `setup-buildx-action` (ou runner `ubuntu-24.04-arm` se disponível,
      sem QEMU), login GHCR, `build-push-action` para as 3 imagens com
      `platforms: linux/arm64`, tags `latest` + `sha`, cache `type=gha`;
      job `deploy` com `appleboy/ssh-action`: `cd /opt/cobot && docker
    compose pull && docker compose up -d --remove-orphans && docker image
    prune -f`.
- [ ] `infra/docker-compose.yml`: imagens apontando para
      `ghcr.io/<owner>/cobot-{bot,web,migrate}:${TAG:-latest}`.
- [ ] `infra/scripts/deploy.sh` (o mesmo que a Action roda, para deploy
      manual) e `infra/scripts/bootstrap-server.sh` (passos 4 acima,
      idempotente).
- [ ] Badge de CI e seção "Deploy" no README.
- [ ] Concurrency no workflow de deploy (`cancel-in-progress: false`,
      grupo `deploy`).

**Arquivos criados/alterados:** `.github/workflows/{ci,deploy}.yml`,
`infra/docker-compose.yml`, `infra/scripts/*.sh`, `README.md`.

**Critérios de aceite:**

- PR com erro de tipo falha no CI.
- Push na `main` publica as 3 imagens arm64 no GHCR e a instância atualiza
  sozinha (`docker compose ps` mostra novo `sha`).
- `https://cobot.seudominio.com` abre com certificado válido; login
  Discord funciona; bot online.
- Deploy total (CI + build + deploy) ≤ 15 min.

**Comandos de validação:**

```bash
git push origin main            # acompanhar em Actions
ssh ubuntu@$SSH_HOST 'cd /opt/cobot && docker compose ps && docker compose logs --tail 20 bot'
curl -sI https://cobot.seudominio.com | head -5
```

▶ Etapa concluída. Rode /clear antes de iniciar a próxima etapa para limpar o contexto.

---

## Etapa 20 — Hardening e observabilidade

**Contexto mínimo para esta etapa:** `CLAUDE.md`, `.harness/prd.md` §7.3,
§7.5, §11, esta etapa, `apps/bot/src/api/server.ts`, `apps/bot/src/logger.ts`,
`apps/bot/src/index.ts`, `apps/web/next.config.ts`, `apps/web/middleware.ts`,
`apps/web/auth.ts`, `infra/docker-compose.yml`, `infra/Caddyfile`,
`.github/workflows/deploy.yml`.

**Objetivo:** fechar os riscos do PRD §11: backups, alertas, métricas
básicas, rate limiting no painel, revisão de segurança, retenções, runbook.

**Pré-requisitos:** Etapas 1–19, produção no ar.

**Tarefas:**

- [ ] **Backups**: serviço `backup` no Compose (`postgres:16-alpine` com
      cron interno ou `prodrigestivill/postgres-backup-local` arm64) fazendo
      `pg_dump` diário, retenção 7 diários + 4 semanais, no volume
      `backups`; script `infra/scripts/restore.sh`; testar restore num
      banco temporário. ⚠️ AÇÃO MANUAL opcional: bucket no Oracle Object
      Storage + `rclone` para cópia externa (documentar, não obrigar).
- [ ] **Alertas**: webhook de Discord (`ALERT_WEBHOOK_URL`) usado pelo bot
      para: boot, shutdown, desconexão do gateway > 60s, erro não tratado
      (com dedupe de 5 min), falha de flush de stats, backup falhou.
- [ ] **Métricas**: `GET /metrics` na API interna (formato Prometheus, sem
      lib pesada: contadores de eventos, comandos, erros, latência p50/p95
      da API, tamanho das filas) — sem Prometheus rodando por enquanto; o
      painel mostra um card "Saúde" em `/g/[guildId]/system` (uptime, memória
      RSS dos processos, ping, filas, último backup, versão/sha).
- [ ] **Painel**: rate limit por IP nas rotas de auth e nas server actions de
      escrita (memória, 60/min), `Auth.js` com `trustHost` correto e cookie
      `__Secure-`; revisar CSP no build de produção (sem `unsafe-eval`);
      página `/system` só `owner`.
- [ ] **Bot**: `pino.redact` revisado; body limit e timeouts na API interna;
      `AbortSignal.timeout` em todos os `fetch` do Discord; guard de tamanho
      de regex; verificação de que nenhum handler deixa interação sem
      resposta (timeout de 2.5s → `deferReply` automático).
- [ ] **Retenções** rodando como jobs (message_cache 7d, automod_hits 30d,
      stats rollup 90d) com log de quantidade removida e alerta se falhar.
- [ ] **Docker**: `read_only: true` + `tmpfs` onde possível, `cap_drop:
    ALL`, `no-new-privileges`, healthcheck do Postgres, `docker system
    prune` semanal via cron do host (documentado no bootstrap).
- [ ] **Dependências**: `pnpm audit` no CI (falha em `high`), Dependabot
      semanal para npm e GitHub Actions.
- [ ] **Runbook** `docs/runbook.md`: como ver logs, reiniciar, restaurar
      backup, rotacionar token da API interna e do bot, adicionar um
      moderador ao painel, o que fazer se o gateway cair, checklist mensal
      (espaço em disco, backups, `docker stats`).
- [ ] **Revisão final**: rodar `/security-review` do Claude Code sobre o repo
      e corrigir o que for `high`.
- [ ] Atualizar `.harness/prd.md` §11 com o status de cada mitigação.

**Arquivos criados/alterados:** `infra/docker-compose.yml`, `infra/scripts/
{restore,backup}.sh`, `apps/bot/src/services/alerts.ts`, `apps/bot/src/api/
routes/metrics.ts`, `apps/bot/src/jobs/*.ts`, `apps/web/app/g/[guildId]/
system/page.tsx`, `apps/web/lib/rate-limit.ts`, `.github/dependabot.yml`,
`docs/runbook.md`.

**Critérios de aceite:**

- `docker compose exec backup ls /backups` lista um dump de hoje; restore
  em banco temporário funciona.
- Derrubar a rede do bot por 90s → alerta no webhook; voltar → alerta de
  reconexão.
- `/g/[guildId]/system` mostra uptime, memória, filas e último backup.
- `pnpm audit --audit-level high` limpo; CI verde; `/security-review` sem
  `high`.
- `docker stats` em produção: bot < 300 MB, web < 500 MB, total < 1.5 GB.

**Comandos de validação:**

```bash
ssh ubuntu@$SSH_HOST 'cd /opt/cobot && docker compose ps && docker compose exec backup ls -la /backups && docker stats --no-stream'
pnpm audit --audit-level high
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

▶ Etapa concluída. Rode /clear antes de iniciar a próxima etapa para limpar o contexto.

---

## Depois da Etapa 20 (backlog, fora do plano)

Multi-servidor real (seletor de guild no painel, registro global de comandos,
onboarding), Postgres `LISTEN/NOTIFY` no `ConfigBus`, i18n, anti-emoji/
anti-attachment, leveling, integração com Object Storage para transcripts,
dashboard público de stats.
