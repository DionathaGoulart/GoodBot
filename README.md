# Goodbot

[![CI](https://github.com/DionathaGoulart/Goodbot/actions/workflows/ci.yml/badge.svg)](https://github.com/DionathaGoulart/Goodbot/actions/workflows/ci.yml)
[![Versão](https://img.shields.io/github/v/release/DionathaGoulart/Goodbot?label=vers%C3%A3o)](CHANGELOG.md)
[![Licença: MIT](https://img.shields.io/badge/licen%C3%A7a-MIT-blue)](LICENSE)

Bot de moderação para Discord com painel web. Tudo que o bot faz se configura
pelo navegador, sem redeploy, e a hospedagem inteira cabe no plano gratuito de
três provedores.

> **English:** Goodbot is a Discord moderation bot with a web dashboard:
> moderation cases, automod, logs, tickets, role panels, welcome messages,
> YouTube alerts and live squad finding
> for games. It is a TypeScript monorepo (discord.js
> v14, Next.js, Postgres with Drizzle) that runs entirely on free tiers
> (Oracle Cloud, Vercel, Supabase). The bot, the dashboard and the docs are in
> Brazilian Portuguese.

## Duas formas de usar

**Convidar o Goodbot.** A instância pública aceita qualquer servidor:

- [Convite normal](https://invite.goodbot.dionatha.com.br): o servidor entra
  numa fila e o bot começa a atender quando o convite é aprovado.
- [Demonstração](https://demo.goodbot.dionatha.com.br): o bot atende na hora,
  por 1 hora, e depois sai sozinho.

O painel fica em [goodbot.dionatha.com.br](https://goodbot.dionatha.com.br),
com login pelo Discord. Quem convidou recebe uma DM a cada passo do convite.

**Hospedar o seu.** O código é aberto e sob a licença MIT. Você precisa de uma
aplicação no Discord, uma VM x86 com Docker (a Always Free da Oracle serve), a
Vercel para o painel e um Postgres (o Supabase gratuito serve). O caminho
completo está em [`docs/deploy.md`](docs/deploy.md).

## Módulos

Cada módulo liga e desliga por servidor, tem uma página no painel e um schema
Zod próprio em `packages/shared/src/config/`:

| Módulo             | O que faz                                                                               |
| ------------------ | --------------------------------------------------------------------------------------- |
| **Moderação**      | ban (inclusive temporário), kick, timeout, warn e notas, em casos numerados com mod-log |
| **Automod**        | spam, links, caps, palavras, menções e modo anti-raid                                   |
| **Logs**           | mensagens, membros, servidor e voz em canais separados                                  |
| **Boas-vindas**    | mensagem de entrada, de saída e DM, por template                                        |
| **Autorole**       | cargos na entrada e verificação por botão                                               |
| **Reaction roles** | painéis de cargo por botão, menu ou reação                                              |
| **Tickets**        | tipos, painel de abertura, transcript e fechamento                                      |
| **Tags**           | respostas salvas com autocomplete                                                       |
| **Utilidades**     | clear, purge, lock, slowmode, lembretes, enquetes e info                                |
| **Estatísticas**   | mensagens, entradas e saídas, voz e casos agregados por hora e dia                      |
| **Redes sociais**  | avisa quando um canal do YouTube publica vídeo, short ou live                           |
| **Buscar squad**   | cargo de quem quer jogar agora, salas de voz que nascem e somem e jogatina agendada     |

O de redes sociais não pede credencial nenhuma: tudo sai de páginas públicas do
YouTube. Detalhes de cada módulo, comandos e configuração em
[`docs/modulos.md`](docs/modulos.md).

## O painel

- configuração de cada módulo, com validação igual à do bot;
- membros, cargos e canais do servidor, com toda escrita passando pelo bot;
- casos de moderação com filtros, desfazer e exportação CSV;
- estatísticas de atividade;
- auditoria imutável de tudo que o painel altera;
- o perfil do bot naquele servidor: apelido, foto, capa e bio.

Quem entra no painel é decidido **por servidor**: administrador, quem tem
Gerenciar Servidor, ou os cargos que o servidor liberar.

## Configurar um servidor por arquivo

Além do painel, a estrutura de um servidor (cargos, categorias, canais e
permissões) pode morar num `guild.yaml` e ser aplicada de uma vez:

```bash
pnpm guild scan "Meu Servidor"          # analisa o servidor e escreve o guild.yaml
pnpm guild plan  --server meu-servidor  # mostra o que mudaria
pnpm guild apply --server meu-servidor  # executa, depois de confirmar
```

O arquivo não tem ID nenhum, só nomes, então pode ir para um repositório
público. O apply é idempotente e **nunca apaga** sem `--allow-delete`.
Detalhes em [`docs/guild-como-codigo.md`](docs/guild-como-codigo.md).

## Rodando localmente

Requisitos: Node 22 (`.nvmrc`), pnpm 9 (`corepack enable`) e Docker.

```bash
cp .env.example .env                                   # preencher DISCORD_TOKEN etc.
docker compose -f infra/docker-compose.dev.yml up -d   # só o Postgres
pnpm install
pnpm db:migrate
pnpm dev                                               # bot em :3001, painel em :3000
```

Antes de abrir um PR: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
O passo a passo completo, com a aplicação no Discord, está em
[`docs/primeiros-passos.md`](docs/primeiros-passos.md).

## Como é por dentro

```
   painel (Next.js, Vercel) ──HTTPS + Bearer──▶ API do bot (Hono) ──▶ Discord
   CLI de guild ──────────────────────────────▶        │
                                                        ▼
                                              Postgres (Supabase)
```

O painel nunca fala com o Discord: toda ação passa pela API do bot, o único
processo com sessão de gateway aberta. Por isso painel, comandos e CLI herdam
as mesmas checagens de permissão, hierarquia e rate limit.

```
apps/bot                bot Discord + API interna (Hono) + jobs
apps/web                painel Next.js (App Router, Tailwind, shadcn/ui, Auth.js)
packages/db             Drizzle: schema, migrations e repositories
packages/shared         Zod: schemas, tipos e constantes do bot e do painel
packages/guild-config   guild como código: guild.yaml, plano e apply
infra/                  Docker Compose, Caddy, fail2ban, scripts de deploy e backup
.harness/               PRD, mapa da arquitetura e guia visual
docs/                   guias de uso e de operação
```

Para entender o código, comece por
[`.harness/architecture.md`](.harness/architecture.md): o que existe, onde mora
e por quê.

## Documentação

| Guia                                                | Para quê                                           |
| --------------------------------------------------- | -------------------------------------------------- |
| [`primeiros-passos.md`](docs/primeiros-passos.md)   | subir o projeto do zero na sua máquina             |
| [`modulos.md`](docs/modulos.md)                     | o que cada módulo faz e como configurar            |
| [`guild-como-codigo.md`](docs/guild-como-codigo.md) | configurar um servidor por arquivo                 |
| [`deploy.md`](docs/deploy.md)                       | hospedar em produção: provedores, segredos, deploy |
| [`runbook.md`](docs/runbook.md)                     | operação: incidentes, backup, rollback             |
| [`api-interna.md`](docs/api-interna.md)             | falar com a API do bot direto                      |
| [`banco-de-dados.md`](docs/banco-de-dados.md)       | schema, migrations e repositories                  |
| [`.harness/prd.md`](.harness/prd.md)                | requisitos, modelo de dados e decisões             |
| [`.harness/styleguide.md`](.harness/styleguide.md)  | guia visual do painel                              |

O que muda entre versões fica no [`CHANGELOG.md`](CHANGELOG.md).

## Contribuir

Issues e PRs são bem-vindos. As convenções (idioma, commits, checklist de PR)
estão em [`CONTRIBUTING.md`](CONTRIBUTING.md). O projeto também traz um
[`CLAUDE.md`](CLAUDE.md) com as regras para quem trabalha com agentes de IA.

## Segurança

Achou uma falha? **Não abra issue pública.** O caminho para reportar em
privado está no [`SECURITY.md`](SECURITY.md).

## Licença

[MIT](LICENSE) © 2026 Dionatha Goulart.

Pode usar, modificar, hospedar e até vender. A condição é manter o aviso de
copyright e a licença (o arquivo `LICENSE`) em qualquer cópia ou fork, ou
seja, o crédito ao autor original vai junto. Se o Goodbot ajudou você, um link
para este repositório é muito bem-vindo.
