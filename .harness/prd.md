# CoBot — PRD (Product Requirements Document)

Versão 1.1 · 2026-09-06 · Documento de referência para todas as sessões.
Leia junto com `.harness/styleguide.md` (UI) e `.harness/plan.md` (execução).

> **v1.1 — mudança de hospedagem.** A v1.0 assumia tudo numa VM ARM
> (Ampere A1) com um único Docker Compose. A capacidade A1 do free tier é
> intermitente e impediu a criação da instância, então a hospedagem passou a
> ser dividida: **bot** na Oracle E2.1.Micro (x86, Always Free), **painel**
> na Vercel e **Postgres** no Supabase. O que mudou: §5.7, §7.2, §7.3, §7.5,
> §11 e §12. O que **não** mudou: requisitos funcionais, modelo de dados,
> permissões, styleguide e o monorepo.

---

## 1. Visão

CoBot é um bot de moderação completo para Discord acompanhado de um painel web
que gerencia **tudo** do servidor e do bot: configuração de cada módulo,
membros, cargos, canais, casos de moderação e estatísticas de atividade. Roda
em uma única instância ARM (Oracle Cloud Free Tier) com Docker Compose, custo
zero de hospedagem, e é projetado para um servidor pequeno hoje sem impedir
multi-servidor amanhã.

Frase-guia: _um só lugar para moderar, configurar e entender o servidor._

## 2. Público

- **Owner do servidor** (o autor): configura tudo, vê estatísticas, gerencia
  quem modera.
- **Moderadores**: aplicam punições (pelo Discord ou pelo painel), consultam
  histórico de casos, atendem tickets.
- **Membros**: interagem com comandos utilitários, tickets, reaction roles,
  polls. Nunca acessam o painel.

## 3. Objetivos

1. Substituir bots de terceiros (MEE6/Dyno/Carl) por algo próprio, auditável
   e sem paywall.
2. Todo comportamento do bot configurável pelo painel sem redeploy.
3. Histórico de moderação persistente, consultável por membro e por período.
4. Estatísticas suficientes para entender crescimento e atividade.
5. Deploy reproduzível por `git push` para a instância Oracle.

## 4. Não-objetivos (v1)

- Música, economia, leveling/XP, minigames.
- Multi-servidor **ativo** (o schema suporta, a UI e o bot operam em um
  `guildId` configurado).
- Sharding (um servidor não precisa; discord.js só exige acima de 2.500
  guilds).
- App móvel; o painel é responsivo, e isso basta.
- Redis/fila externa. Config no Postgres com cache em memória no bot.
- Localização: UI e mensagens em pt-BR; strings centralizadas para permitir
  i18n depois, sem implementar agora.
- Dashboard público / vitrine.

## 5. Requisitos funcionais — Bot

Cada módulo tem `enabled` e configuração própria, lida do Postgres com cache
(ver §8). Todo comando de moderação aceita `motivo` (obrigatório para ban,
opcional nos demais, padrão `[sem motivo]`) e, quando aplicável, `duração`.

### 5.1 Moderação e casos

| Comando        | Opções                                                              | Efeito                                                                                                     |
| -------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `/ban`         | user, motivo*, apagar_msgs (0–7 dias), duração (opcional = tempban) | ban; cria caso `BAN`; DM ao alvo (configurável)                                                            |
| `/unban`       | user_id, motivo                                                     | unban; caso `UNBAN`                                                                                        |
| `/softban`     | user, motivo, apagar_msgs                                           | ban + unban imediato; caso `SOFTBAN`                                                                       |
| `/kick`        | user, motivo                                                        | kick; caso `KICK`                                                                                          |
| `/timeout`     | user, duração (≤28d), motivo                                        | timeout nativo; caso `TIMEOUT`                                                                             |
| `/untimeout`   | user, motivo                                                        | remove timeout; caso `UNTIMEOUT`                                                                           |
| `/warn`        | user, motivo                                                        | caso `WARN`; DM ao alvo; escalada automática opcional (N warns em X dias → timeout/kick/ban, configurável) |
| `/note`        | user, texto                                                         | caso `NOTE`, invisível ao alvo                                                                             |
| `/case view`   | id                                                                  | embed do caso                                                                                              |
| `/case edit`   | id, motivo                                                          | edita motivo; registra `editedBy`                                                                          |
| `/case delete` | id                                                                  | soft delete (`deletedAt`); só admin                                                                        |
| `/history`     | user, [tipo], [página]                                              | lista paginada de casos do usuário                                                                         |
| `/reason`      | id, motivo                                                          | atalho de `case edit`                                                                                      |

Regras:

- Hierarquia: moderador não pune quem tem cargo igual/superior ao seu nem o
  bot pune quem está acima dele; erro claro em embed.
- Tempban e timeout têm `expiresAt`; um scheduler no bot (poll a cada 30s na
  tabela, sem cron externo) desfaz e cria caso `UNBAN`/`UNTIMEOUT` com
  `actor = bot`.
- Menu de contexto (user command) "Punir…" abrindo modal com tipo/motivo/
  duração.
- Cada caso gera mensagem no mod-log (§5.4) e a mensagem é editada quando o
  caso é editado.
- Casos criados pelo painel passam pela API interna (§5.7) e têm
  `source = 'dashboard'`.

### 5.2 Automod

Regras avaliadas em `messageCreate`/`messageUpdate` e `guildMemberAdd`, na
ordem: allowlist (cargos/canais isentos) → regras habilitadas por prioridade.
Cada regra tem `actions[]` executadas em sequência: `delete`, `warn`,
`timeout(duração)`, `kick`, `ban`, `notify_modlog`, `dm_user`. Ações de
punição criam caso com `actor = bot`, `source = 'automod'`, `ruleId`.

| Regra                                             | Parâmetros                                                                                                                                       |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| anti-spam                                         | N mensagens em X segundos por usuário; N mensagens idênticas; janela por canal                                                                   |
| anti-links                                        | allowlist de domínios; bloquear convites do Discord separadamente; permitir em canais listados                                                   |
| anti-caps                                         | % mínimo de maiúsculas e tamanho mínimo da mensagem                                                                                              |
| filtro de palavras                                | listas (exata, wildcard, regex com timeout de execução); múltiplas listas com ações diferentes                                                   |
| anti-menção em massa                              | N menções (usuários+cargos) por mensagem; `@everyone`/`@here` sem permissão                                                                      |
| anti-raid                                         | N entradas em X segundos → modo raid por Y minutos: kick/ban de novas entradas, ou exigir conta com idade ≥ Z dias; alerta no mod-log; `/raid on | off` manual |
| anti-emoji-spam / anti-attachment (opcional v1.1) | limites por mensagem                                                                                                                             |

Métricas de cada regra (hits por dia) vão para stats (§5.6).

### 5.3 Utilidades

| Comando             | Notas                                                                                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/purge`            | quantidade (1–500), filtros: user, apenas_bots, contém (texto), apenas_links, apenas_anexos, antes_de/depois_de (message id); respeita limite de 14 dias do bulk delete e faz delete individual para o resto (com aviso) |
| `/slowmode`         | segundos (0–21600), canal opcional                                                                                                                                                                                       |
| `/lock` / `/unlock` | canal opcional, motivo; nega `SendMessages` ao @everyone (e cargos configurados) preservando overrides anteriores para restaurar                                                                                         |
| `/lockdown`         | lock em todos os canais de uma categoria/lista configurada                                                                                                                                                               |
| `/userinfo`         | id, criação, entrada, cargos, contagem de casos, avatar                                                                                                                                                                  |
| `/serverinfo`       | membros, canais, cargos, boosts, criação, owner                                                                                                                                                                          |
| `/avatar`           | global e de servidor                                                                                                                                                                                                     |
| `/roleinfo`         | membros, permissões, cor, posição                                                                                                                                                                                        |
| `/remind`           | `em 2h texto` / lista / cancelar; DM ou canal                                                                                                                                                                            |
| `/poll`             | pergunta, 2–10 opções, duração, múltipla escolha; botões; resultado ao encerrar                                                                                                                                          |
| `/ping`, `/help`    | latência gateway/API/DB; lista de comandos por módulo                                                                                                                                                                    |

### 5.4 Logs

Cada tipo de log tem canal configurável (ou herda do "canal de logs geral") e
toggle independente:

- **mod-log**: todo caso (§5.1), automod (§5.2), lock/unlock, purge.
- **mensagens**: edição (antes/depois, link), exclusão (conteúdo, anexos como
  nome+tamanho), bulk delete (arquivo .txt anexado). Cache local de mensagens
  (LRU, últimas N por canal) para recuperar conteúdo de mensagens não
  cacheadas pelo discord.js.
- **membros**: entrada (idade da conta, contagem), saída (cargos que tinha,
  tempo no servidor), mudança de nick, mudança de cargos (quem mudou via
  audit log), mudança de avatar (opcional).
- **servidor**: canal criado/editado/deletado, cargo criado/editado/deletado,
  emoji/sticker, mudanças em configurações do servidor (via audit log).
- **voice**: join/leave/move, mute/deafen de servidor.
- Canais/cargos podem ser ignorados por tipo de log.

### 5.5 Comunidade

- **Boas-vindas/saída**: canal, template com variáveis (`{user}`, `{mention}`,
  `{server}`, `{memberCount}`, `{ordinal}`), texto ou embed, DM opcional na
  entrada, `/welcome test`.
- **Autorole**: cargos ao entrar (humano e bot separados); atraso opcional;
  "cargo de verificação" via botão em mensagem persistente.
- **Reaction roles**: mensagens com botões ou select menu (preferência) ou
  reações; modos único/múltiplo/toggle; limites por grupo; criação pelo painel
  e por `/reactionrole create`.
- **Tickets**: painel com botão abre canal privado (ou thread privada) em
  categoria configurada, com cargos de suporte; `/ticket close|add|remove|
claim|rename`; transcript em HTML/TXT enviado ao canal de log e ao usuário;
  limite de tickets abertos por usuário; múltiplos "tipos" de ticket com
  categorias diferentes.
- **Tags**: `/tag <nome>` responde texto/embed; `/tag create|edit|delete|
list`; permissão por cargo para criar; contador de uso; editáveis no painel.

### 5.6 Estatísticas (coleta)

Eventos agregados em memória e persistidos a cada 60s (flush) na tabela
`stat_buckets(guildId, kind, key, bucket_hour, count)`:

- mensagens por canal por hora; por usuário por dia (top ativos);
- entradas/saídas por dia; total de membros (snapshot diário);
- minutos em voice por canal por hora;
- casos de moderação por tipo por dia; hits de automod por regra por dia;
- comandos usados por nome por dia;
- tickets abertos/fechados por dia.

Retenção: buckets horários por 90 dias, depois agregados a diários; job
noturno no bot. Nenhum conteúdo de mensagem é armazenado nas stats.

### 5.7 API do bot (Hono)

Servidor HTTP no processo do bot (`:3001`). Desde a v1.1 o painel roda fora
da VM (Vercel), então esta API é **exposta na internet** pelo Caddy em
`https://bot.<dominio>` — o container continua sem publicar porta no host, só
o Caddy o alcança. Auth por header `Authorization: Bearer
<INTERNAL_API_TOKEN>` com comparação em tempo constante, mais rate limit e
body cap (§7.3). Endpoints (todos validados com Zod de `packages/shared`):

- `GET /health` — status gateway, ping, uptime, guild cache.
- `GET /guilds/:id/channels|roles|members?q=&limit=` — dados ao vivo do cache
  do bot (com fallback a fetch).
- `GET /guilds/:id/members/:userId` — detalhe ao vivo.
- `POST /guilds/:id/moderation` — `{type, targetId, reason, duration,
actorId}` → executa a ação e cria caso (mesmo caminho que o slash command).
- `POST /guilds/:id/config/invalidate` — `{module}` → bot recarrega cache
  daquele módulo (o painel chama após salvar).
- `POST /guilds/:id/messages` — enviar/editar mensagem de welcome-test,
  reaction-role panel, ticket panel ou escrita à mão no painel (`dashboard`).
  Menções só saem no que o corpo marcar; `@everyone` exige `actorId` com a
  permissão no Discord. Balde próprio de 10/min por guild (§7.4).
- `GET /guilds/:id/channels/:id/messages` — últimas 50 do canal, cada uma
  relida como template para o painel abrir no editor.
- `DELETE /guilds/:id/channels/:id/messages/:id` — apagar pelo painel;
  devolve o que foi apagado, que é o que a auditoria guarda.
- `POST /guilds/:id/reaction-roles/:id/publish`, `POST /tickets/panel/publish`.
- `GET /guilds/:id/audit-log?type=&limit=` — proxy para audit log do Discord.

`/health` é o único endpoint sem auth, e responde apenas `{ok: true}` sem
token (o corpo detalhado exige o Bearer), para servir de healthcheck.

Ponto de extensão: `invalidate` é hoje HTTP; a interface `ConfigBus`
(`publish(module)` / `subscribe`) permite trocar por Postgres `LISTEN/NOTIFY`
ou Redis pub/sub depois sem tocar nos módulos.

### 5.8 Notificações de redes sociais

Avisa num canal do Discord quando a conta configurada publica algo. Uma
**conta** = plataforma + identificador externo + canal de destino + template.
Várias contas por servidor, cada uma com seu canal e sua menção opcional.

Tudo por **polling** no scheduler do bot, nunca por webhook de entrada: a API
do bot está exposta na internet e §7.3 proíbe rota sem autenticação além do
`/health`. O intervalo é configurável por plataforma (padrão 5 min), com
backoff ao errar e desativação automática após 10 falhas seguidas (com
alerta).

Idempotência é o requisito central: cada publicação vista vira uma linha em
`social_posts` antes do envio. Nada é anunciado duas vezes, mesmo com restart
do bot no meio do ciclo.

- **YouTube** — feed RSS público do canal
  (`/feeds/videos.xml?channel_id=UC…`), sem API key e sem cota. Cobre
  **vídeos** e **shorts**; distinguir os dois exige um `HEAD` em
  `youtube.com/shorts/<id>` (200 = short, redirect = vídeo comum). **Lives**
  não aparecem no RSS de forma confiável: exigem a Data API v3
  (`search?eventType=live`, 100 unidades de cota por chamada, teto diário de
  10.000) — ou seja, live custa uma API key e um intervalo mais folgado (15
  min). O usuário escolhe quais tipos quer: vídeo, short, live.
- **Twitch** — Helix `streams?user_login=…` com App Access Token (client
  credentials). Avisa quando a live abre; não re-anuncia enquanto continuar a
  mesma sessão (`stream.id`). Preferido sobre EventSub justamente por não
  exigir rota pública de callback.
- **Instagram/Reels** — Graph API da Meta (`/{ig-user-id}/media`). ⚠️ Exige
  conta **Business ou Creator** vinculada a uma Página do Facebook, um app na
  Meta e as permissões `instagram_basic` + `pages_show_list` aprovadas. Sem
  isso o módulo não tem como funcionar, e o painel deve dizer isso na cara do
  usuário em vez de falhar silenciosamente.
- **TikTok** — sem API pública que sirva: a Content Posting API é de
  publicação, e a Display API exige aprovação comercial. Fica como **melhor
  esforço**, atrás de um aviso explícito no painel de que pode parar de
  funcionar a qualquer momento e sem promessa de suporte.

Template por conta, com as variáveis `{title}`, `{url}`, `{author}`,
`{thumbnail}`, `{platform}`, `{kind}`; texto ou embed, seguindo o mesmo
motor de templates das boas-vindas (§5.5). Menção opcional a um cargo, com
`allowedMentions` restrito a ele.

**Notas de implementação (Etapa 21).** Três decisões que o desenho acima não
fixava e que valem para quem for mexer no módulo depois:

- `{thumbnail}` existe como variável de texto, mas a capa da publicação entra
  mesmo como **imagem do embed**, e só quando o template não define uma imagem
  própria. Um card com a capa é o que dá ao anúncio a cara que se espera.
- A **primeira passada de uma conta nova não anuncia nada**: ela grava em
  `social_posts` o que já existia e passa a avisar do próximo post em diante.
  Sem isso, adicionar um canal antigo despejaria o feed inteiro no canal.
  `social.announceBacklog` inverte esse comportamento, e nasce desligado.
- O **IG User ID não é variável de ambiente**: ele identifica cada conta e
  entra no painel, junto do canal e do template. Da Meta vem só o
  `META_ACCESS_TOKEN`, que é do app e vale para todas as contas.
- A conta guarda `poll_interval_s` próprio, mas a busca de **live no YouTube**
  respeita os 15 min da cota mesmo que a conta esteja em 1 min.
- O backoff de uma conta em falha vive **em memória**: um restart tenta de
  novo na hora (o que se quer depois de um deploy), enquanto o contador de
  falhas — que é o que desliga a conta no décimo erro — fica no banco.

## 6. Requisitos funcionais — Painel

Acesso: login com Discord OAuth2 (Auth.js). Após login, o painel verifica se
o usuário é membro do servidor configurado **e** tem permissão
`Administrator` **ou** `ManageGuild` **ou** um dos cargos listados em
`dashboard_access_roles`. Caso contrário → "Acesso negado". Sessão JWT
(cookie httpOnly), 7 dias, re-verificação de permissão a cada 15 min
(cache) e em toda ação de escrita.

### 6.1 Dashboard

- Stat tiles: membros (com delta 7d), mensagens hoje/7d, casos 7d, tickets
  abertos, automod hits 24h, status do bot (uptime, ping).
- Gráficos: mensagens por dia (30d) com comparação ao período anterior;
  crescimento de membros (90d); heatmap hora × dia da semana; top 10
  canais; casos por tipo (barras empilhadas, 30d); automod por regra.
- Atividade recente: últimos 10 casos e últimos 10 eventos de auditoria.
- Seletor de período (7d/30d/90d/custom).

### 6.2 Configuração por módulo

Uma página por módulo, mesmo layout: toggle "módulo ativo" no topo, cards
por seção, rodapé sticky de salvar. Ao salvar: valida com Zod (shared),
grava, escreve auditoria (§6.5), chama `invalidate` no bot, toast.

- **Geral**: prefixo de embed (cor), timezone, idioma (fixo pt-BR), cargos
  de moderador/admin do bot, cargos com acesso ao painel, canal de logs
  geral, DM ao punido (on/off por tipo, template).
- **Moderação**: escalada de warns, duração padrão de timeout, dias de purge
  padrão em ban, canal de mod-log, exigir motivo (por tipo).
- **Automod**: lista de regras (tabela: nome, tipo, ativa, hits 24h, ações),
  criar/editar regra em `sheet` com formulário específico por tipo, ordem por
  drag (ou campo prioridade), allowlists globais (cargos/canais), anti-raid
  com botão "ativar modo raid agora".
- **Logs**: grade tipo × (ativo, canal), canais/cargos ignorados.
- **Boas-vindas/saída**: editor de template com preview de embed, canal, DM,
  botão "enviar teste".
- **Autorole**: cargos humanos/bots, atraso, verificação por botão (canal,
  mensagem, cargo).
- **Reaction roles**: lista de painéis; editor: canal, mensagem/embed, modo,
  itens (emoji, label, cargo); publicar/atualizar/remover.
- **Tickets**: tipos (nome, categoria, cargos de suporte, mensagem de
  abertura, limite), painel (canal, embed, botões), transcript on/off, canal
  de log; lista de tickets abertos/fechados com link de transcript.
- **Tags**: tabela CRUD com editor (texto/embed), permissão de criação.
- **Comandos**: por comando: ativo, cargos permitidos, canais permitidos/
  negados (override de permissão do Discord via API de permissões de
  comando quando possível; senão checagem no handler).

### 6.3 Gestão do servidor

- **Membros**: busca (nome/ID) via API interna, tabela com avatar, nome,
  cargos, entrada, contagem de casos; página do membro: info, cargos
  (adicionar/remover), casos (tabela), botões de punição (modal com motivo/
  duração → API interna), notas.
- **Cargos**: lista com cor, membros, posição, permissões perigosas
  destacadas; criar/editar/deletar (nome, cor, hoist, mentionable,
  permissões por checklist); mover posição.
- **Canais**: árvore por categoria; criar/editar/deletar; slowmode; lock/
  unlock; overrides básicos (view/send por cargo).
- Toda escrita nesta seção vai pela API interna do bot (o bot tem o token
  e faz a ação; o painel nunca chama a API do Discord com o token do bot).

### 6.4 Casos

Tabela com filtros: tipo, moderador, alvo, período, origem (comando/painel/
automod), texto do motivo; ordenação; paginação server-side; exportar CSV.
Detalhe do caso: editar motivo, apagar (soft), ver mensagem do mod-log,
desfazer (unban/untimeout) quando aplicável.

### 6.5 Auditoria do painel

Toda mutação feita pelo painel gera `audit_logs(actorId, action, target,
before, after, ip, userAgent, createdAt)`. Página com tabela filtrável por
ator, ação, período, e diff antes/depois em JSON. Imutável (sem delete).

## 7. Requisitos não funcionais

### 7.1 Single-server hoje, multi-server amanhã

- Toda tabela tem `guild_id` (snowflake como `bigint`/`text`) e todo índice
  composto começa por ele.
- O bot lê `GUILD_ID` do ambiente e ignora eventos de outras guilds
  (`if (guildId !== env.GUILD_ID) return`) num único middleware; para
  multi-guild, remove-se o filtro e o cache de config vira `Map<guildId,…>`
  (já é).
- O painel tem `guildId` na sessão (fixo hoje); rotas em
  `/g/[guildId]/...` desde o início para não migrar URLs.
- Slash commands registrados como **guild commands** (instantâneos) na guild
  configurada; flag para registro global.

### 7.2 Performance no free tier

- **VM (Oracle E2.1.Micro, 1 OCPU / 1 GB, x86_64)**: roda só `bot` e
  `caddy`. Orçamento: bot ≤ 300 MB RSS (`mem_limit: 384m`), caddy ≤ 50 MB,
  sobrando ~500 MB para o sistema. Swap de 2 GB configurado no host, porque
  1 GB não perdoa pico.
- **Painel (Vercel)**: `output` padrão (não `standalone`); server components
  com `fetch` paralelo; nada de trabalho pesado por request. Cold start
  importa: manter dependências do server enxutas.
- **Postgres (Supabase free)**: 500 MB de armazenamento — as retenções do §8
  já cabem nisso com folga; `shared_buffers` é do provedor, não nosso.
  Painel conecta pelo **pooler** (pgBouncer) porque funções serverless abrem
  muitas conexões curtas; o bot conecta direto, com pool de no máximo 5.
- Imagem `linux/amd64` para o bot; base `node:22-alpine`.
- Stats agregadas em memória e flush em lote (§5.6); nunca 1 INSERT por
  mensagem.
- Cache de config no bot com TTL de segurança (5 min) além da invalidação
  explícita — agora ainda mais importante, já que cada leitura do painel
  cruza a internet.
- Consultas do painel paginadas server-side; gráficos lêem de `stat_buckets`
  (nunca de tabelas de eventos brutos).
- Logs pino em JSON, nível `info` em prod, rotação pelo Docker
  (`max-size=10m, max-file=5`).

### 7.3 Segurança

- **OAuth**: Auth.js com provider Discord, scopes `identify guilds
guilds.members.read`; `AUTH_SECRET` ≥ 32 bytes; cookies `Secure`,
  `HttpOnly`, `SameSite=Lax`; callback URL fixa por ambiente; sem refresh
  token armazenado além do necessário (não guardar access token do usuário
  depois da verificação inicial; re-verificar via API do bot, que tem cache
  de membros).
- **Autorização**: checagem de permissão em **todo** server action / route
  handler, não só no layout; helper `requireGuildAccess(session, guildId,
level)`.
- **API do bot (exposta)**: desde a v1.1 o painel roda fora da VM, então a
  API do bot é publicada pelo Caddy num subdomínio dedicado
  (`bot.<dominio>`), **só** com TLS. Defesas obrigatórias, porque o token
  passa a ser a única barreira: token longo aleatório (`openssl rand -hex
32`), comparação timing-safe, rate limit 60 req/min por IP **e** 100/min por
  rota (memória), body ≤ 256 KB, Zod em toda entrada, sem CORS (nenhum
  `Access-Control-Allow-Origin`), sem listagem de rotas, respostas de erro
  sem stack. O container do bot não publica porta no host: só o Caddy
  alcança `bot:3001` pela rede do Compose. **Única exceção ao teto de corpo**
  (Etapa 23): `PATCH /guilds/:id` aceita 12 MB, porque ícone e banner do
  servidor viajam como data URL e 8 MB de imagem (o limite do Discord) viram
  ~11 MB em base64. Toda outra rota continua em 256 KB.
- **Segredos**: só via `.env` na VM (nunca commitado; `.env.example` sim),
  GitHub Secrets para a CI e variáveis de ambiente do projeto na Vercel. O
  `INTERNAL_API_TOKEN` existe nos três lugares e é rotacionado junto.
- **Web**: CSP restritiva (self + fonts locais), sem `unsafe-inline` exceto
  o script de tema com nonce; CSRF coberto por server actions (origin check)
  e cookie `SameSite`; headers de segurança configurados no `next.config.ts`
  (não mais no Caddy, que só atende a API do bot).
- **Discord**: bot com o mínimo de permissões (ver §10); intents privilegiadas
  `GuildMembers` e `MessageContent` (necessárias para automod/logs);
  `GuildPresences` **não**.
- **Postgres gerenciado**: conexão só por TLS (`sslmode=require`); usuário da
  aplicação sem privilégio de superusuário; senha só em segredo; painel usa a
  string do **pooler** (pgBouncer, porta 6543) e o bot usa a conexão direta
  (5432), que suporta pool longo; backups do provedor + `pg_dump` próprio
  (§7.5 e etapa de hardening).
- **Entrada do usuário**: regex de filtro de palavras compilada com limite de
  tamanho e testada com timeout (safe-regex ou `re2`; fallback: rejeitar
  regex com grupos aninhados quantificados).

### 7.4 Rate limits do Discord

- discord.js gerencia o REST rate limit; o bot **nunca** faz fetch em loop
  (usa cache, `fetch` só sob demanda e com `{ cache: true }`).
- Purge usa `bulkDelete` (limite 100/chamada, 14 dias) e enfileira o resto
  com delay de 1s por chamada individual, com progresso na resposta
  efêmera.
- Mod-log e logs de mensagem passam por uma fila por canal (coalescing:
  até 10 embeds por mensagem, flush a cada 2s) para não estourar 5 msgs/5s
  por canal.
- Anti-raid em modo ban usa fila com concorrência 2.
- Escrever mensagem pelo painel tem balde próprio (10/min por guild), bem
  abaixo do teto por rota: é o endpoint mais fácil de abusar do painel.
- API interna propaga `429` do Discord como `503 + retryAfter` para o painel
  mostrar toast "Discord limitou; tente em Ns".
- Registro de comandos só quando o manifesto muda (hash em tabela `meta`).

### 7.5 Confiabilidade e operação

- Reconexão automática do gateway (discord.js); `unhandledRejection` logado,
  nunca derruba o processo; `healthcheck` no Compose para `bot` e `caddy`;
  `restart: unless-stopped`.
- Migrations executadas pela CI contra o Postgres gerenciado, em um job que
  roda **antes** do deploy do bot e do painel; nunca pelo processo do bot no
  boot. Deploy manual usa `pnpm --filter @cobot/db db:migrate` com a
  `DATABASE_URL` de produção.
- O painel na Vercel é stateless: qualquer instância pode atender qualquer
  request; nada de estado em memória entre requests.
- Graceful shutdown: flush de stats, fechar HTTP, destruir client, 10s de
  timeout.

## 8. Modelo de dados (alto nível)

Todas as tabelas em `packages/db/src/schema/*.ts`, snake_case no banco,
`guild_id` + `created_at` em tudo, IDs do Discord como `text` (snowflake),
PKs internas como `bigserial` ou `uuid` onde indicado.

```
guilds            (id PK text, name, icon, owner_id, joined_at, left_at)
guild_settings    (guild_id PK/FK, timezone, embed_color, mod_role_ids[], admin_role_ids[],
                   dashboard_access_role_ids[], log_channel_id, dm_on_punish jsonb, updated_at)
module_configs    (guild_id, module PK(guild_id,module), enabled, config jsonb, version, updated_at, updated_by)
                   -- módulo ∈ moderation|automod|logs|welcome|autorole|reaction_roles|tickets|tags|utilities|stats|social
cases             (id bigserial PK, guild_id, case_number (seq por guild), type enum,
                   target_id, target_tag, actor_id, actor_tag, reason, duration_ms, expires_at,
                   source enum(command|dashboard|automod|context|escalation), automod_rule_id FK?,
                   modlog_message_id, modlog_channel_id, edited_by, edited_at, deleted_at, created_at)
                   idx (guild_id, target_id), (guild_id, created_at desc), (guild_id, expires_at) where expires_at not null
scheduled_actions (id, guild_id, case_id FK, kind enum(unban|untimeout|unlock|reminder|poll_close), run_at, payload jsonb, done_at)
automod_rules     (id, guild_id, name, type enum, enabled, priority, config jsonb, actions jsonb,
                   exempt_role_ids[], exempt_channel_ids[], created_at, updated_at)
automod_hits      (id, guild_id, rule_id FK, user_id, channel_id, message_id, action_taken, created_at)
                   -- retenção 30 dias
log_configs       (guild_id, kind PK(guild_id,kind), enabled, channel_id, ignored_channel_ids[], ignored_role_ids[])
message_cache     (message_id PK, guild_id, channel_id, author_id, content, attachments jsonb, created_at)
                   -- só se módulo logs ativo; retenção 7 dias; usado para recuperar conteúdo em delete
welcome_configs   (guild_id PK, join_enabled, join_channel_id, join_template jsonb, leave_*, dm_enabled, dm_template jsonb)
social_accounts   (id PK, guild_id, platform enum(youtube|twitch|instagram|tiktok),
                   external_id (channel_id/user_login/ig_user_id), handle, display_name,
                   discord_channel_id, kinds[] (video|short|live|post), template jsonb,
                   mention_role_id, enabled, poll_interval_s, last_checked_at,
                   last_external_id, failure_count, disabled_reason, created_at, updated_at)
                   unique (guild_id, platform, external_id)
social_posts      (id PK, guild_id, account_id FK, external_id, kind, url, title,
                   published_at, announced_at, message_id)
                   unique (account_id, external_id)  -- a trava contra anúncio duplicado
                   -- retenção 90 dias
autorole_configs  (guild_id PK, human_role_ids[], bot_role_ids[], delay_s, verify_enabled, verify_channel_id, verify_message_id, verify_role_id)
reaction_role_panels (id, guild_id, channel_id, message_id, mode enum(single|multiple|toggle), style enum(buttons|select|reactions), content jsonb)
reaction_role_items  (id, panel_id FK, role_id, emoji, label, description, position)
ticket_types      (id, guild_id, name, category_id, support_role_ids[], opening_message jsonb, max_open_per_user, naming_pattern)
ticket_panels     (id, guild_id, channel_id, message_id, content jsonb, type_ids[])
tickets           (id, guild_id, number (seq por guild), type_id FK, user_id, channel_id, status enum(open|closed), claimed_by, closed_by, close_reason, transcript_url, opened_at, closed_at)
tags              (id, guild_id, name unique(guild_id,name), content jsonb, created_by, uses, created_at, updated_at)
reminders         (id, guild_id, user_id, channel_id (null=DM), text, run_at, done_at)
polls             (id, guild_id, channel_id, message_id, question, options jsonb, multiple, ends_at, closed_at, votes jsonb)
stat_buckets      (guild_id, kind, key, bucket_start timestamptz, granularity enum(hour|day), count bigint,
                   PK(guild_id, kind, key, bucket_start, granularity))
                   -- kind ∈ messages_channel|messages_user|joins|leaves|members_total|voice_minutes_channel|
                   --         cases_type|automod_rule|commands|tickets_open|tickets_closed
audit_logs        (id, guild_id, actor_id, actor_tag, action, target_type, target_id, before jsonb, after jsonb, ip, user_agent, created_at)
                   -- append-only
dashboard_sessions? -- não: Auth.js JWT stateless; se migrar para DB sessions, adapter Drizzle
meta              (key PK, value jsonb)  -- hash do manifesto de comandos, versão de schema de config, etc.
```

Relações principais: `guilds 1—N cases`, `cases 1—0..1 scheduled_actions`,
`automod_rules 1—N automod_hits`, `automod_rules 1—N cases`,
`reaction_role_panels 1—N items`, `ticket_types 1—N tickets`, `ticket_panels
N—N ticket_types` (array), tudo `N—1 guilds`.

Config de módulo: `module_configs.config` é jsonb validado por um schema Zod
**por módulo** em `packages/shared/src/config/<module>.ts`, com `version` para
migração de formato. O bot e o painel importam o mesmo schema.

## 9. Permissões

### 9.1 No Discord (comandos)

Três níveis, resolvidos por `guild_settings` + permissões nativas:

| Nível    | Quem                                                                    | Comandos                                                                                     |
| -------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `admin`  | `Administrator` ou cargo em `admin_role_ids`                            | tudo, incluindo `/case delete`, `/lockdown`, `/raid`, config                                 |
| `mod`    | `ModerateMembers`/`BanMembers`/`KickMembers` ou cargo em `mod_role_ids` | moderação, purge, slowmode, lock, tickets (staff), tags CRUD                                 |
| `member` | todos                                                                   | userinfo, serverinfo, avatar, roleinfo, remind, poll, tag (usar), ticket (abrir), help, ping |

`default_member_permissions` no registro do comando espelha o nível; o handler
re-verifica (o registro é dica de UI, não segurança).

### 9.2 No painel

| Nível   | Quem                                              | Pode                                                                              |
| ------- | ------------------------------------------------- | --------------------------------------------------------------------------------- |
| `owner` | owner do servidor                                 | tudo + gerenciar quem acessa o painel                                             |
| `admin` | `Administrator`/`ManageGuild` ou `admin_role_ids` | configurar módulos, gestão de servidor, casos, auditoria                          |
| `mod`   | `mod_role_ids` ou `dashboard_access_role_ids`     | dashboard, membros (buscar, ver casos, punir), casos (ver/editar motivo), tickets |

Checagem no servidor em cada action/route via `requireGuildAccess`. Ações de
punição pelo painel respeitam a mesma hierarquia de cargos do Discord (o bot
verifica na API interna usando `actorId`).

## 10. Permissões do bot no Discord (convite)

`ViewChannel, SendMessages, SendMessagesInThreads, EmbedLinks, AttachFiles,
ReadMessageHistory, ManageMessages, ManageChannels, ManageRoles, ManageGuild,
KickMembers, BanMembers, ModerateMembers, ViewAuditLog, ManageThreads,
AddReactions, UseExternalEmojis, MuteMembers, DeafenMembers, MoveMembers,
CreateInstantInvite, ManageEvents, ManageGuildExpressions`.

`ManageGuild` entrou na Etapa 23 (editar nome, ícone, banner e nível de
verificação pelo painel). Sem ela o bot continua funcionando: a tela
`/servidor` fica em leitura e diz o que falta, em vez de falhar no envio.

`CreateInstantInvite`, `ManageEvents` e `ManageGuildExpressions` entraram na
Etapa 25 (convites, eventos agendados, emojis e stickers pelo painel). Valem a
mesma regra: sem elas as telas `/convites`, `/eventos` e `/emojis` ficam em
leitura e explicam qual permissão falta. `ManageGuild` também é o que o Discord
exige para *listar* convites.
Sem `Administrator`. Intents: `Guilds, GuildMembers, GuildModeration,
GuildMessages, MessageContent, GuildMessageReactions, GuildVoiceStates,
DirectMessages, GuildEmojisAndStickers`.

## 11. Riscos

Status revisado na Etapa 20 (2026-09-07). **Feito** = mitigação implementada e
verificável no repositório; **parcial** = implementada com limitação conhecida,
descrita na linha; **manual** = depende de uma ação do operador na VM ou num
provedor, documentada em `docs/runbook.md`.

| Risco                                                             | Mitigação                                                                                                                                  | Status |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| Intents privilegiadas exigem verificação acima de 100 servidores  | irrelevante em single-server; documentar                                                                                                   | feito — §10 e §7.3 |
| Free tier da Oracle reclama instâncias ociosas                    | bot mantém CPU > 0; monitorar; não é "idle" com gateway aberto                                                                             | feito — gateway aberto + `/metrics` |
| **Capacidade Ampere A1 indisponível**                             | resolvido: v1.1 usa E2.1.Micro (x86), que não sofre com capacidade                                                                         | feito — Etapa 18 |
| **API do bot exposta na internet**                                | subdomínio próprio, Bearer de 32 bytes com comparação timing-safe, rate limit 60/min por IP, body ≤ 256 KB, sem CORS, fail2ban no Caddy (§7.3) | feito (fail2ban **manual**) — `api/server.ts`, `infra/fail2ban/`; alerta a cada 50 respostas 401 numa hora |
| **Latência web → bot / web → banco**                              | Vercel e Supabase na mesma região (`sa-east-1` / GRU quando possível); painel usa cache do bot; server components paralelizam fetches       | feito — medida no card **Saúde** (`/g/[guildId]/system`) e no `cobot_api_duration_ms` |
| **Limites do free tier da Vercel/Supabase**                       | painel de um servidor está muito abaixo dos limites; alerta de uso; migração para VM continua possível (o Compose antigo fica documentado)  | parcial — não existe alerta automático de cota; é item do checklist mensal do runbook (a Vercel e o Supabase não expõem isso no free tier) |
| **Supabase pausa projeto por inatividade (7 dias)**               | o bot mantém conexão e escrita constante; alerta se `pg_dump` diário falhar                                                                | feito — ping a cada 60s (`watchDatabase`), alerta "Postgres inacessível"; `backup.sh` alerta ao falhar |
| Regex do usuário (ReDoS)                                          | limite + timeout + validação no painel                                                                                                     | feito — `safe-regex2` no schema Zod (painel recusa ao salvar) **e** na compilação do bot; padrão ≤ 200 chars, entrada ≤ 2 000 chars |
| Perda de mensagens de log por rate limit                          | fila com coalescing (§7.4)                                                                                                                 | feito — `LogQueue`; tamanho da fila exposto no `/metrics` e no card Saúde |
| Token da API do bot vazar em log                                  | nunca logar headers; pino `redact`; rotação documentada no runbook                                                                         | feito — `logger.ts` (`redact`), rotação nos três cofres em `docs/runbook.md` |
| Auth.js + Discord: `guilds.members.read` exige o usuário na guild | tratar 403 como "acesso negado"                                                                                                            | feito — `resolveGuildLevel` → `/denied` |
| Drift entre schema Zod de config e jsonb salvo                    | campo `version` + migração de config na leitura                                                                                            | feito — `packages/shared/src/config` |
| Disco cheio (logs, message_cache)                                 | retenções (§8), rotação Docker; o disco do banco agora é do Supabase (alerta de cota)                                                       | feito — `RetentionJob` com alerta na falha; `json-file` com 5×10 MB; `docker system prune` semanal no bootstrap |
| OneDrive sincronizando `node_modules` no Windows do dev           | `.gitignore` + trabalhar via WSL (path `/mnt/c/...` já é o caso); pnpm com `node-linker=hoisted` não é necessário; documentar no CLAUDE.md | feito — CLAUDE.md |
| **Backup do Supabase não é exportável no free tier**              | `pg_dump` próprio diário no serviço `backup` do Compose, 7 diários + 4 semanais no volume `backups`; `infra/scripts/restore.sh`             | feito — cópia externa (Object Storage + rclone) segue **opcional e não implementada** |
| **Perder o rastro do que está rodando na VM**                     | `GIT_SHA` embutido na imagem pela CI, exibido no `/health`, no card Saúde e no alerta de boot                                              | feito — `infra/docker/bot.Dockerfile` |
| **Rate limit do painel na Vercel**                                | 60/min por IP nas rotas de auth e nas server actions de escrita                                                                             | parcial — contagem **por instância**, porque o painel é stateless e a stack não tem store compartilhado (§12); serve para cortar script, não como cota |

## 12. Decisões arquiteturais (com justificativa)

| Decisão                             | Por quê                                                                                                                                |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo pnpm workspaces            | um repo, tipos compartilhados sem publicar pacote; pnpm é rápido e disciplinado com deps fantasmas                                     |
| TypeScript em tudo                  | tipos do discord.js e do Drizzle são o principal valor; Zod fecha o ciclo em runtime                                                   |
| discord.js v14 + slash commands     | lib madura, tipagem forte, suporte completo a interações (modais, botões, select, context menus)                                       |
| Handler próprio de comandos/eventos | evita framework opinativo (sapphire) numa base pequena; total controle sobre permissões e carga de config                              |
| Hono para a API do bot              | minúsculo, rápido, tipado, roda em Node sem adaptação; suficiente para uma API de superfície pequena                                   |
| pino                                | JSON estruturado, barato em CPU, `redact` nativo                                                                                       |
| PostgreSQL                          | relacional cabe no domínio (casos, configs, stats agregadas); jsonb dá flexibilidade para config por módulo; um único serviço de dados |
| Drizzle ORM                         | schema em TS, migrations SQL versionadas e legíveis, sem runtime pesado, queries tipadas; sem binário nativo                           |
| Next.js App Router                  | server components e server actions eliminam uma API pública separada; roda nativamente na Vercel                                       |
| Tailwind + shadcn/ui                | componentes copiados para o repo, totalmente tematizáveis com o styleguide neobrutal (radius 0, borda 2px)                             |
| Auth.js com Discord OAuth2          | provider pronto, JWT stateless, sem tabela de sessão                                                                                   |
| Zod em `packages/shared`            | um schema por config e por payload da API do bot, importado por bot e web: validação idêntica dos dois lados                           |
| Sem Redis                           | um processo de bot + config no Postgres com cache em memória cobre single-server; `ConfigBus` abstrai o pub/sub para depois            |
| **Hospedagem dividida** (v1.1)      | a capacidade Ampere A1 do free tier é intermitente e bloqueou a criação da VM; o bot sozinho cabe na E2.1.Micro (1 GB), que sempre tem capacidade. Painel e banco saem para serviços gerenciados |
| **Bot na Oracle E2.1.Micro (x86)**  | Always Free e sempre disponível; o bot é ≤ 300 MB RSS e precisa de processo longo com gateway aberto — exatamente o que serverless não faz |
| **Imagens `linux/amd64`**           | consequência do E2.1.Micro; some o build QEMU/ARM na CI, que era o passo mais lento do deploy                                          |
| **Painel na Vercel**                | Next.js roda nativamente, deploy por git, previews por PR, HTTPS e CDN sem configurar nada; plano Hobby é gratuito para uso não-comercial |
| **Postgres no Supabase**            | free tier sempre ligado (Neon suspende por inatividade e o pool do bot brigaria com isso); backups gerenciados; pooler pgBouncer necessário para as funções serverless da Vercel |
| **API do bot exposta com TLS**      | com o painel fora da Oracle, `bot ↔ web` deixa de ser rede privada; Caddy publica só essa API num subdomínio, protegida por Bearer token, rate limit e body cap (§7.3) |
| Docker Compose + Caddy              | um arquivo descreve o que roda na VM (bot + caddy); Caddy faz HTTPS automático (Let's Encrypt) e headers; sem nginx + certbot         |
| GitHub Actions → SSH deploy         | build amd64 na CI (imagem no GHCR), servidor só faz `docker compose pull && up -d`; sem build na instância free tier                   |
| Config no banco, não em arquivo     | painel precisa alterar em tempo real sem redeploy                                                                                      |
| Stats em buckets agregados          | free tier: nunca guardar evento bruto por mensagem; consultas do painel ficam baratas                                                  |
