# CoBot — instruções para o Claude Code

Bot de moderação para Discord (discord.js v14) + painel web (Next.js) num
monorepo pnpm. Tudo em TypeScript. Idioma do projeto: **pt-BR** (docs,
commits, UI, mensagens do bot); nomes de código em inglês.

**Hospedagem (PRD v1.1):** dividida em três — o **bot** roda numa VM
`VM.Standard.E2.1.Micro` da Oracle (x86_64, 1 OCPU / 1 GB, Always Free) via
Docker Compose com Caddy na frente; o **painel** roda na Vercel; o
**Postgres** é gerenciado no Supabase. Imagens Docker são `linux/amd64`.

## Antes de agir (obrigatório em toda sessão)

1. Leia `.harness/prd.md` — requisitos, modelo de dados, permissões, decisões.
2. Leia `.harness/styleguide.md` se a tarefa tocar em `apps/web` ou em embeds.
3. Abra `.harness/plan.md`, veja a tabela **Estado** e leia **somente a etapa
   atual** (a primeira com status `pendente` ou `em andamento`). A etapa lista
   o "Contexto mínimo" — leia exatamente aqueles arquivos, não o repo inteiro.
4. Marque a etapa como `em andamento` na tabela antes de começar e como
   `concluída` ao terminar (com a data), junto com os checkboxes das tarefas.
5. Não pule etapas nem antecipe trabalho de etapas futuras. Se algo de uma
   etapa futura for pré-requisito real, faça o mínimo e anote na etapa futura.
6. Toda etapa termina com a linha `▶ Etapa concluída. Rode /clear antes de
iniciar a próxima etapa para limpar o contexto.` — repita-a ao usuário.

A stack está **definida** no PRD §12. Não proponha alternativas (nem Redis,
nem Prisma, nem outro framework web). Pontos que exigem ação manual do usuário
estão marcados no plano com `⚠️ AÇÃO MANUAL`; pare e peça quando chegar neles.

## Layout do repositório

```
apps/bot          discord.js v14, handler próprio, API interna Hono, pino
apps/web          Next.js App Router, Tailwind, shadcn/ui, Auth.js (Discord)
packages/db       Drizzle: schema em src/schema/*.ts, migrations em drizzle/
packages/shared   Zod: schemas de config por módulo, payloads da API interna, tipos, constantes
infra/            docker-compose.yml, Caddyfile, Dockerfiles, scripts de deploy
.harness/         prd.md, styleguide.md, plan.md (fonte de verdade)
```

## Convenções

- **Gerenciador:** pnpm (workspaces). Nunca `npm`/`yarn`. Instalar com
  `pnpm install`; rodar scripts com `pnpm --filter <pkg> <script>` ou os
  atalhos da raiz (`pnpm dev`, `pnpm build`, `pnpm lint`, `pnpm typecheck`,
  `pnpm test`). Node 22 LTS.
- **Schema e migrations:** só em `packages/db`. Alterou `src/schema/*.ts` →
  `pnpm --filter @cobot/db db:generate` (gera SQL em `drizzle/`) → revisar o
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
- **Commits:** Conventional Commits em pt-BR no corpo, tipo em inglês:
  `feat(bot): comando /ban com tempban`, `fix(web): tema não persistia`,
  `chore(infra): ...`. Um commit por tarefa lógica; ao fim de cada etapa um
  commit `chore(plan): etapa N concluída`. Só commitar quando o usuário pedir
  ou quando a etapa mandar.
- **Segredos:** NUNCA commitar `.env*` (exceto `.env.example`). Variáveis
  documentadas em `.env.example` com comentário. Verificar `git status` antes
  de commitar.
- **UI:** seguir `.harness/styleguide.md` à risca: radius 0, borda 2px,
  sombra dura, JetBrains Mono, temas `crimson`/`rose`, hex só em
  `globals.css`. Componentes shadcn são editados em `apps/web/components/ui`.
- **Discord:** IDs sempre `string`; nunca `Number(snowflake)`. Comandos
  registrados como guild commands. Respeitar rate limits (PRD §7.4).
- **API do bot:** desde a v1.1 ela é exposta na internet (`bot.<dominio>`),
  porque o painel roda fora da VM. Todo endpoint novo exige Bearer,
  validação Zod e conta no rate limit; nunca adicione rota sem auth além do
  `/health` (PRD §5.7, §7.3). O container do bot não publica porta no host.
- **Três provedores, três cofres de segredo:** VM (`.env`), GitHub Secrets
  (CI) e variáveis do projeto na Vercel. `INTERNAL_API_TOKEN` vive nos três
  e é rotacionado nos três juntos.
- **Single-server hoje, multi amanhã:** todo query filtra por `guildId`;
  nunca assumir uma única guild fora de `env.GUILD_ID`.

## Como rodar localmente

```bash
cp .env.example .env            # preencher DISCORD_TOKEN, etc.
docker compose -f infra/docker-compose.dev.yml up -d postgres
pnpm install
pnpm --filter @cobot/db db:migrate
pnpm dev                        # bot + web em paralelo (turbo/concurrently)
```

Em dev tudo é local: Postgres no Docker, bot em `:3001`, painel em `:3000`.
Os serviços gerenciados (Supabase, Vercel) só entram em produção.

Validação padrão de uma etapa (rodar tudo antes de marcar como concluída):

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

## Ambiente do desenvolvedor

Windows + WSL2; o repo vive em `/mnt/c/...` sincronizado pelo OneDrive.
`node_modules` está no `.gitignore` e deve ficar fora do OneDrive se a sync
incomodar (alternativa: `pnpm config set store-dir ~/.pnpm-store`). Comandos
Docker rodam no WSL.
