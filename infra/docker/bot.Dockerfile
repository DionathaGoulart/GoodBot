# syntax=docker/dockerfile:1
#
# Imagem do bot (@goodbot/bot). Contexto de build: a raiz do monorepo.
# Alvo: linux/amd64 (Oracle E2.1.Micro, PRD §12).
#
#   docker build --platform linux/amd64 -f infra/docker/bot.Dockerfile -t goodbot-bot .

# ── base ─────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1
RUN corepack enable
WORKDIR /repo

# ── build: instala só a árvore do bot, compila com tsup e faz o deploy ────────
FROM base AS build
# Os manifests e o lockfile vêm antes do código: mudar um `.ts` não refaz o
# install. O filtro `@goodbot/bot...` restringe o download às dependências do bot
# e dos pacotes de workspace que ele usa — as do painel nunca são baixadas.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/bot/package.json ./apps/bot/
COPY apps/web/package.json ./apps/web/
COPY packages/db/package.json ./packages/db/
COPY packages/shared/package.json ./packages/shared/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @goodbot/bot...

COPY packages/shared ./packages/shared
COPY packages/db ./packages/db
COPY apps/bot ./apps/bot
RUN pnpm --filter @goodbot/bot build

# `deploy` monta um diretório autocontido só com o que o runtime precisa:
# `dist/` e as dependências de produção (os pacotes do workspace já foram
# embutidos no bundle pelo tsup, via `noExternal`).
RUN pnpm --filter @goodbot/bot --prod deploy /out \
    && rm -rf /out/src /out/tsup.config.ts /out/tsconfig.json /out/vitest.config.ts

# ── runtime ──────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
# Sha do commit que gerou a imagem. Aparece no `/health`, no card "Saúde" do
# painel e no alerta de boot — é como se sabe o que está rodando na VM.
ARG GIT_SHA=
ENV GIT_SHA=${GIT_SHA}
ENV NODE_ENV=production
# 1 GB de RAM na VM: o heap do V8 fica abaixo do `mem_limit` do Compose.
ENV NODE_OPTIONS=--max-old-space-size=256
WORKDIR /app

COPY --from=build --chown=node:node /out ./

USER node
EXPOSE 3001

# `/health` responde mesmo antes do gateway abrir (PRD §5.7).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.INTERNAL_API_PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
