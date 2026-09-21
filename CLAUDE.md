# Goodbot — instruções para o Claude Code

Bot de moderação para Discord (discord.js v14) + painel web (Next.js) num
monorepo pnpm. Tudo em TypeScript. Idioma do projeto: **pt-BR** (docs,
commits, UI, mensagens do bot); nomes de código em inglês.

**Hospedagem (PRD v1.1):** dividida em três — o **bot** roda numa VM
`VM.Standard.E2.1.Micro` da Oracle (x86_64, 1 OCPU / 1 GB, Always Free) via
Docker Compose com Caddy na frente; o **painel** roda na Vercel; o
**Postgres** é gerenciado no Supabase. Imagens Docker são `linux/amd64`.

## Antes de agir (obrigatório em toda sessão)

1. Leia `.harness/architecture.md` — o mapa do código: o que cada camada faz,
   onde cada coisa mora e por quê. É o caminho mais curto para se situar sem
   ler o repositório inteiro.
2. Leia `.harness/prd.md` — requisitos, modelo de dados, permissões, decisões.
3. Leia `.harness/styleguide.md` se a tarefa tocar em `apps/web` ou em embeds.
4. Leia apenas os arquivos que a tarefa exige. O `architecture.md` diz onde
   procurar; não varra o repositório por hábito.

A stack está **definida** no PRD §12. Não proponha alternativas (nem Redis,
nem Prisma, nem outro framework web). Quando uma tarefa depender de uma ação
que só o usuário pode fazer (criar recurso num provedor, preencher segredo,
aprovar app numa plataforma), pare e peça — não invente contorno.

## Layout do repositório

```
apps/bot                discord.js v14, handler próprio, API interna Hono, pino
apps/web                Next.js App Router, Tailwind, shadcn/ui, Auth.js (Discord)
packages/db             Drizzle: schema em src/schema/*.ts, migrations em drizzle/
packages/shared         Zod: schemas de config por módulo, payloads da API interna, tipos, constantes
packages/guild-config   guild como código: guild.yaml -> plano -> apply pela API do bot
infra/                  docker-compose.yml, Caddyfile, Dockerfiles, deploy, discord/<slug>/
.harness/               prd.md, architecture.md, styleguide.md (fonte de verdade)
docs/                   guias: primeiros passos, módulos, API, banco, runbook
```

## Convenções

- **Gerenciador:** pnpm (workspaces). Nunca `npm`/`yarn`. Instalar com
  `pnpm install`; rodar scripts com `pnpm --filter <pkg> <script>` ou os
  atalhos da raiz (`pnpm dev`, `pnpm build`, `pnpm lint`, `pnpm typecheck`,
  `pnpm test`). Node 22 LTS.
- **Schema e migrations:** só em `packages/db`. Alterou `src/schema/*.ts` →
  `pnpm --filter @goodbot/db db:generate` (gera SQL em `drizzle/`) → revisar o
  SQL → `db:migrate`. Nunca editar migration já aplicada; nunca `db:push` fora
  de dev.
- **Validação:** todo input externo (slash command options, body da API
  interna, formulário do painel, jsonb de config) passa por um schema Zod de
  `packages/shared`. Bot e web importam o mesmo schema.
- **Config de módulo:** lida via `ConfigService` do bot (cache + invalidate),
  nunca query direta dentro de um comando/evento.
- **Logs:** pino. Nunca `console.log` fora de scripts. Nunca logar tokens,
  headers ou conteúdo de mensagens em nível `info`.
- **Erros:** classe `UserFacingError` para erros que viram embed/toast; o
  resto sobe e é logado. Handlers de interação sempre respondem (efêmero em
  erro).
- **Lint/format:** ESLint (flat config) + Prettier na raiz. `pnpm lint` e
  `pnpm typecheck` devem passar antes de dar uma etapa por concluída.
- **Testes:** Vitest. Unitários para regras de automod, parsers de duração,
  templates, schemas Zod e helpers de permissão. `pnpm test`.
- **Commits:** Conventional Commits **inteiramente em inglês** — assunto e
  corpo. Assunto no imperativo, minúsculo, sem ponto final, até 72 caracteres:
  `feat(bot): add tempban to /ban`, `fix(web): keep the theme across reloads`.
  O corpo (quebrado em 72 colunas) explica o **porquê** e o que a mudança
  quebraria se fosse feita de outro jeito; o que ela faz já está no diff.
  Isto vale só para o Git: prosa, UI e mensagens do bot continuam em pt-BR.
  Um commit por tarefa lógica. Só commitar quando o usuário pedir ou quando a
  etapa mandar.
- **Segredos:** NUNCA commitar `.env*` (exceto `.env.example`). Variáveis
  documentadas em `.env.example` com comentário. Verificar `git status` antes
  de commitar.
- **UI:** seguir `.harness/styleguide.md` à risca: radius 0, borda 2px,
  sombra dura, JetBrains Mono, temas `crimson`/`rose`, hex só em
  `globals.css`. Componentes shadcn são editados em `apps/web/components/ui`.
- **Guild como código:** estrutura de servidor (cargos, canais, permissões)
  vive em `infra/discord/<slug>/guild.yaml`, **sem nenhum ID** — tudo por nome.
  Segredo do servidor fica no `.env` ao lado, gitignored. Rode `pnpm guild plan`
  antes de `apply`; nada é apagado sem `--allow-delete`.
  Para entender um servidor antes de mexer: `pnpm guild scan "<nome>"` escreve
  `servidor.md` (a análise) ao lado do yaml. A skill `reformar-servidor` tem o
  fluxo inteiro.
- **Discord:** IDs sempre `string`; nunca `Number(snowflake)`. Comandos
  registrados como guild commands. Respeitar rate limits (PRD §7.4).
- **API do bot:** desde a v1.1 ela é exposta na internet (`bot.<dominio>`),
  porque o painel roda fora da VM. Todo endpoint novo exige Bearer,
  validação Zod e conta no rate limit; nunca adicione rota sem auth além do
  `/health` (PRD §5.7, §7.3). O container do bot não publica porta no host.
- **Três provedores, três cofres de segredo:** VM (`.env`), GitHub Secrets
  (CI) e variáveis do projeto na Vercel. `INTERNAL_API_TOKEN` vive nos três
  e é rotacionado nos três juntos.
- **Multi-guild:** quem o bot atende é a tabela `guild_registry`, não uma
  variável: `approved` sem prazo, `demo` até `expiresAt`, `pending` e `blocked`
  nunca. `GUILD_IDS` sobrou como **semente** do registro no boot (só cria linha
  que ainda não existe). No bot a leitura é o `RegistryService` (espelho em
  memória, recarregado a cada minuto); no painel, `lib/registry.ts`. Todo query
  filtra por `guildId`, e nada pode assumir "a" guild: no painel, quem decide
  acesso é sempre a guild da URL, e o nível de permissão é **por guild** na
  sessão.

## Como rodar localmente

```bash
cp .env.example .env            # preencher DISCORD_TOKEN, etc.
docker compose -f infra/docker-compose.dev.yml up -d postgres
pnpm install
pnpm --filter @goodbot/db db:migrate
pnpm dev                        # bot + web em paralelo (concurrently)
```

Em dev tudo é local: Postgres no Docker, bot em `:3001`, painel em `:3000`.
Os serviços gerenciados (Supabase, Vercel) só entram em produção.

Validação padrão de uma etapa (rodar tudo antes de marcar como concluída):

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```
