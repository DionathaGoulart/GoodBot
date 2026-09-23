# Goodbot: PRD (Product Requirements Document)

Versão 1.8 · 2026-09-23 · Documento de referência para todas as sessões.
Leia junto com `.harness/architecture.md` (código) e `.harness/styleguide.md` (UI).

> As versões v1.0 a v1.8 citadas aqui são **revisões deste documento**, não
> versões do software. O software segue SemVer a partir da 1.0.0, e o que muda
> entre uma versão e outra está no [`CHANGELOG.md`](../CHANGELOG.md).

> **v1.8: buscar squad.** O squad fixo saiu. No lugar entrou um módulo sem
> perfil e sem match, feito para "quem quer jogar agora". Um cargo
> (`Buscando Squad`) marca quem está buscando, e liga de dois jeitos: o bot vê
> o jogo aberto (rich presence) e pergunta por DM, ou a pessoa aperta um
> botão, que é o caminho de quem joga em console. Salas de voz efêmeras, com
> nome do alfabeto grego e teto de 4 pessoas, nascem quando alguém entra no
> canal de criar e somem sozinhas quando esvaziam. Uma mensagem fixa lista as
> salas abertas em tempo real, e quando não há ninguém, **MARCAR JOGATINA**
> cria um evento agendado nativo do Discord, com RSVP e lembrete por conta
> dele. Sair da voz só derruba o cargo e a sala depois de uma **janela de
> tolerância** (2 min), porque o Discord manda o mesmo evento para quem sai de
> propósito e para quem perde a conexão. Perfil, grade, perguntas, match,
> proposta, votação de entrada, `/bora`, chamada pública, histórico, números,
> relatório e as nove tabelas do módulo deixaram de existir, e o módulo novo
> não cria tabela. Entrou a intent privilegiada `GuildPresences` (§10). O que
> mudou no documento: §5.11 inteira, a página na §6.2, as tabelas na §8, as
> permissões na §9.1, as permissões e intents na §10, a intent na §5.10 e na
> §7.3 e os riscos na §11. O que **não** mudou: os outros módulos, a
> hospedagem e o ciclo de vida do convite.

> **v1.7: jogatinas monitoradas.** A presença no voice reservado deixou de
> servir só para contar jogatinas: ela passou a medir **tempo**. Uma varredura
> acerta a presença com quem está em voice na reserva, no início e a cada
> passada do job, cobrindo quem já estava na sala e quem entrou ou saiu com o
> bot fora do ar. Dela saem os números do squad: horas por pessoa, por
> tamanho de grupo (solo, dupla, trio, party cheia) e por grupo exato, com
> quem cada um mais joga, e por jogatina quem foi, quem faltou e quem
> apareceu sem avisar. A fonte é só o voice das jogatinas: nada de presença
> de perfil nem de tempo fora de jogatina marcada. A jogatina ganhou
> **REMARCAR**: quem está no "vou" muda o horário sem cancelar, e o squad é
> avisado numa mensagem nova. Quem entra no squad com a sala já reservada
> ganha a sala na hora, e a liberação devolve o voice ao que era também para
> essa pessoa. E a jogatina ganhou **convidado avulso**: quem é do squad traz
> gente de fora para jogar só aquela, com a sala liberada e o aviso numa
> thread privada, sem entrar no squad. O **CHAMAR GENTE** deixou de morrer no
> início: a chamada pública vale até o fim da jogatina, porque falta gente é
> o que se descobre jogando, e quem é aceito no meio cai direto na sala.
> No fim, a mensagem da jogatina vira o **relatório** do que rolou (duração,
> quem jogou com o tempo de cada um, formações, faltas), e o guia passa a
> dizer as horas e a presença do último mês. Para olhar o conjunto há
> `/squad stats` (os seus números num jogo, ou os de quem você apontar) e o
> botão **NÚMEROS** do guia (os do squad inteiro).
> O que mudou no documento: "Jogatina",
> "Convidado avulso", "Chamada pública", "Histórico", "Números", "Onde ver os
> números", "Relatório de fim" e "O relógio" na §5.11,
> `squad_session_guests` e o snapshot de
> `squad_sessions` na §8, o REMARCAR e o TRAZER CONVIDADO na §9.1, a aba de
> configuração na §6.2 e o aviso de manutenção do deploy na §7.5. O que **não** mudou: o resto do módulo e os
> outros módulos.

> **v1.6: jogatina sob demanda.** O squad deixou de ter janela semanal fixa:
> a grade do perfil serve só para o match, e quem marca a hora de jogar é o
> próprio squad, com `/bora` ou o botão **BORA**. A sessão semanal automática
> saiu; **REPETIR** cobre a rotina. Cada squad ganhou um guia fixo, pinado no
> canal, com membros, próximas jogatinas e os botões do squad, e por isso o
> convite passou a pedir `PinMessages`. O jogo ganhou dois tamanhos: o do
> squad (o grupo, até 20) e o da party (quem joga junto numa partida, até 10).
> O match propõe uma party, o squad cresce pela entrada em duas fases e a
> jogatina diz quantas parties dá. Entrar num squad que já existe virou
> convite e votação: o candidato recebe o convite numa thread privada e
> aceita, e o squad vota (empate entra); quem os membros convidam com
> **CONVIDAR** ou `/squad convidar` entra sem voto. Cada squad passou a ter
> **histórico**: o bot registra quem aparece no voice reservado, e o convite,
> o `/squad procurar`, o guia, a chamada pública e o painel dizem quantas
> jogatinas rolaram, quando o squad costuma jogar e quem mais aparece. E a
> jogatina ganhou **CHAMAR GENTE**, que anuncia a jogatina no canal de busca
> para quem não é do squad pedir para entrar. O que mudou no documento:
> §5.11 (tamanhos, match, proposta, entrada, jogatina, chamada pública,
> histórico, guia, ciclo de vida e relógio), a página na §6.2, `squad_games`,
> `squads`, `squad_join_requests`, `squad_sessions` e
> `squad_session_attendance` na §8, `/bora`, `/squad convidar` e os botões
> novos na §9.1, a §10 e dois riscos na §11. O que **não** mudou: o perfil, a
> gestão de jogadores e os outros módulos.

> **v1.5: squads fixos.** Entrou o módulo `squads` (§5.11): perfil de jogador
> com a agenda da semana, match por horário, proposta sem líder, canal privado
> por squad e voice do pool reservado só na hora da sessão. É o primeiro módulo
> que mexe em voice e abre thread privada, e por isso o convite passou a pedir
> `Connect`, `Speak` e `CreatePrivateThreads`. O que mudou no documento: §5.11
> inteira, a página na §6.2, as sete tabelas na §8, os comandos na §9.1, a §10
> e dois riscos na §11. O que **não** mudou: os outros módulos, a hospedagem e
> o ciclo de vida do convite.

> **v1.4: o convite fala.** O ciclo de vida do convite deixou de ser mudo para
> quem convidou: o bot avisa **no privado dessa pessoa** a cada mudança de
> estado (entrou em demo, demo acabando, demo acabou, entrou na fila, aprovado,
> recusado). O aviso de 10 minutos da demo saiu do canal do servidor e passou a
> ser só essa DM. Entrou o status `expired`: convite parado **uma semana** na
> fila é recusado sozinho, o bot se despede e sai. Ao contrário de
> `blocked`, o servidor pode ser convidado de novo. Junto veio a correção de um
> defeito que anulava a demonstração em produção (§5.10, "a corrida do
> `guildCreate`"). O que mudou no documento: §5.10 inteira, `guild_registry` na
> §8 e a §9.3.

> **v1.3: bot público.** O Goodbot deixou de atender uma lista de servidores
> no ambiente e passou a atender uma **tabela** (`guild_registry`): quem entra
> por `invite.` espera aprovação, quem entra por `demo.` é atendido por uma
> hora, e o dono do bot decide o resto num painel próprio em `admin.<domínio>`.
> O que mudou: entrou a §5.10 (o ciclo de vida do convite), e com ela
> `guild_registry` na §8, a fronteira da §7.1, o convite e os hostnames na
> §7.3, o acesso da §6 e o teto de 100 servidores na §11, que deixou de ser
> irrelevante. Quem opera o bot como produto continua na §9.3. O que **não**
> mudou: os módulos do bot, o resto do modelo de dados, os níveis de permissão
> dentro de um servidor e a hospedagem.

> **v1.2: nome e guild como código.** O projeto passou a se chamar
> **Goodbot** (era CoBot): pacotes `@goodbot/*`, imagem `goodbot-bot`,
> métricas `goodbot_*` e `/opt/goodbot` na VM. A migração da VM já rodou e o
> script dela saiu do repositório. Entrou também a §5.9, guild como código. O que
> **não** mudou: requisitos funcionais existentes, modelo de dados, permissões
> e hospedagem.

> **v1.1: mudança de hospedagem.** A v1.0 assumia tudo numa VM ARM
> (Ampere A1) com um único Docker Compose. A capacidade A1 do free tier é
> intermitente e impediu a criação da instância, então a hospedagem passou a
> ser dividida: **bot** na Oracle E2.1.Micro (x86, Always Free), **painel**
> na Vercel e **Postgres** no Supabase. O que mudou: §5.7, §7.2, §7.3, §7.5,
> §11 e §12. O que **não** mudou: requisitos funcionais, modelo de dados,
> permissões, styleguide e o monorepo.

---

## 1. Visão

Goodbot é um bot de moderação completo para Discord acompanhado de um painel web
que gerencia **tudo** do servidor e do bot: configuração de cada módulo,
membros, cargos, canais, casos de moderação e estatísticas de atividade. O bot
roda numa VM x86 da Oracle (Always Free) com Docker Compose, o painel na Vercel
e o Postgres no Supabase, todos no plano gratuito. Nasceu para um servidor
pequeno e desde a v1.3 atende vários, com convite, aprovação e demonstração
(§5.10).

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
- Sharding (um servidor não precisa; discord.js só exige acima de 2.500
  guilds).
- App móvel; o painel é responsivo, e isso basta.
- Redis/fila externa. Config no Postgres com cache em memória no bot.
- Localização: UI e mensagens em pt-BR; strings centralizadas para permitir
  i18n depois, sem implementar agora.
- Dashboard público / vitrine.

## 5. Requisitos funcionais: Bot

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
| `/clear`            | limpeza rápida do canal: quantidade opcional (padrão 50, máximo 500), usuário e canal opcionais; mesmo motor do `/purge`, sem os filtros finos e preservando mensagens fixadas |
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
`https://bot.<dominio>`. O container continua sem publicar porta no host, só
o Caddy o alcança. Auth por header `Authorization: Bearer
<INTERNAL_API_TOKEN>` com comparação em tempo constante, mais rate limit e
body cap (§7.3). Endpoints (todos validados com Zod de `packages/shared`):

- `GET /health`: status gateway, ping, uptime, guild cache.
- `GET /guilds/:id/channels|roles|members?q=&limit=`: dados ao vivo do cache
  do bot (com fallback a fetch).
- `GET /guilds/:id/members/:userId`: detalhe ao vivo.
- `GET /guilds/:id/members/lookup?ids=`: nome e avatar de até 100 IDs
  separados por vírgula (repetidos contam uma vez). Cache primeiro, o resto
  numa busca só pelo gateway; devolve `members`, `missing` (confirmados fora
  do servidor) e `unresolved` (o gateway não respondeu, a tela mostra o ID). É
  leitura, sem `actorId`, como `GET /members`, e fica registrada antes de
  `/members/:userId`.
- `POST /guilds/:id/moderation`: `{type, targetId, reason, duration,
actorId}` → executa a ação e cria caso (mesmo caminho que o slash command).
- `POST /guilds/:id/config/invalidate`: `{module}` → bot recarrega cache
  daquele módulo (o painel chama após salvar).
- `POST /guilds/:id/messages`: enviar/editar mensagem de welcome-test,
  reaction-role panel, ticket panel ou escrita à mão no painel (`dashboard`).
  Menções só saem no que o corpo marcar; `@everyone` exige `actorId` com a
  permissão no Discord. Balde próprio de 10/min por guild (§7.4).
- `GET /guilds/:id/channels/:id/messages`: últimas 50 do canal, cada uma
  relida como template para o painel abrir no editor.
- `DELETE /guilds/:id/channels/:id/messages/:id`: apagar pelo painel;
  devolve o que foi apagado, que é o que a auditoria guarda.
- `POST /guilds/:id/reaction-roles/:id/publish`, `POST /tickets/panel/publish`.
- `GET /guilds/:id/audit-log?type=&limit=`: proxy para audit log do Discord.

`/health` é o único endpoint sem auth, e responde apenas `{ok: true}` sem
token (o corpo detalhado exige o Bearer), para servir de healthcheck.

Ponto de extensão: `invalidate` é hoje HTTP; a interface `ConfigBus`
(`publish(module)` / `subscribe`) permite trocar por Postgres `LISTEN/NOTIFY`
ou Redis pub/sub depois sem tocar nos módulos.

### 5.8 Notificações de redes sociais

Avisa num canal do Discord quando o canal do YouTube configurado publica um
**vídeo**, um **short** ou abre uma **live**. Uma **conta** = canal do YouTube
+ canal de destino no Discord + tipos escolhidos + template. Várias contas por
servidor (teto de 20), cada uma com seu canal e duas menções opcionais: um
cargo para vídeo e short, outro para live.

Desde a v2 o módulo é **só YouTube e sem credencial nenhuma**: nada de API
key, de cota, de projeto no Google Cloud. Os três sinais saem de páginas
públicas do próprio YouTube. Twitch, Instagram e TikTok saíram do código
(ver a nota de futuro no fim da seção).

Tudo por **polling** no scheduler do bot, nunca por webhook de entrada: a API
do bot está exposta na internet e §7.3 proíbe rota sem autenticação além do
`/health`.

**Um laço, um intervalo.** `social.pollIntervalSeconds` (padrão 180 s, mín.
60, máx. 1800) vale para a instância inteira: cada passada percorre **todas**
as contas ligadas em sequência, com 500 ms entre contas. Não há intervalo por
conta, lote nem jitter: com o teto de 20 contas a passada inteira cabe folgada
dentro do menor intervalo. O intervalo é relido a cada passada, então mudá-lo
no painel vale na passada seguinte, sem restart.
Erro numa conta não interrompe as outras: `failure_count` sobe e o último erro
fica em `disabled_reason`. Na décima falha seguida a conta entra em **pausa
automática** (`paused_until`): o job a pula por 15 min, e cada falha seguinte
dobra a espera, até 1 h (era 6 h: o feed do YouTube passou três noites em 404
e a conta só voltava até 4 h depois de a falha acabar). O primeiro sucesso zera
o contador, limpa a pausa e
avisa pelo webhook de alertas, que também avisou na entrada da pausa. O bot
nunca desliga uma conta: `enabled = false` é sempre decisão humana, e salvar a
conta pelo painel zera falhas e pausa. Até a v2.x a décima falha desligava a
conta de vez, e um 404 passageiro do YouTube deixava o anúncio parado até
alguém perceber.

Idempotência é o requisito central: cada publicação vista vira uma linha em
`social_posts` **antes** do envio. Nada é anunciado duas vezes, mesmo com
restart do bot no meio do ciclo. A unique `(account_id, external_id)` é a
trava de verdade.

**Como o detector funciona.** Por conta, a cada passada:

1. **RSS** `feeds/videos.xml?channel_id=UC…` → as 5 entradas mais novas. É o
   que descobre vídeo e short, e traz título, autor, capa e data.

   **O feed não pode calar a live.** Em 16, 17 e 18/09/2026 ele respondeu 404
   (e um 500 de vez em quando) das ~22h às ~6h, todas as noites, enquanto o
   `/channel/UC…/live` do mesmo canal respondia normalmente. Como o feed era
   lido primeiro e lançava, a sonda nem rodava. Agora, numa conta que também
   quer live, o feed é de **melhor esforço**: falhou, a passada segue só com a
   sonda, e o feed espera antes de ser tentado de novo (a primeira falha tenta
   na passada seguinte; da segunda em diante 5 min, dobrando até 30 min). O que
   ficou de fora é anunciado quando ele voltar, porque `social_posts` ainda diz
   que aquilo é novo. Na primeira passada de uma conta o feed continua
   obrigatório, porque é ela que grava o histórico como visto; e uma conta que
   só quer vídeo e short segue a regra de sempre, com falha e pausa.
2. **Sonda de live** `GET /channel/UC…/live` → o `ID` da transmissão sai do
   `<link rel="canonical">` quando ele aponta para `watch?v=ID`, e do
   `currentVideoEndpoint` do `ytInitialData` quando não aponta; com `ID` em
   mãos, `"isLive":true` no HTML confirma a live. Canonical apontando para o
   próprio canal, ou `"isUpcoming":true`, significa "nenhuma live agora".
   Canonical **ausente**, ou qualquer outra forma sem `ID` no JSON, é erro (a
   página mudou), não "sem live": assim uma mudança no YouTube desliga a
   conta com alerta em vez de deixar o módulo mudo.

   A reserva no `ytInitialData` não é preciosismo: em 2026-09-11 o YouTube
   passou a servir a quem não roda JS um `watch` sem nenhuma tag `og:`, sem
   `videoDetails` no `ytInitialPlayerResponse` e com
   `canonical="undefined"`: uma string, não uma tag ausente. A sonda lia
   aquilo como "não tem live" e o módulo atravessava a transmissão inteira
   calado, sem erro e sem `failure_count` subindo. Título e autor do anúncio
   vêm, nesse formato, do `videoPrimaryInfoRenderer` e do
   `videoOwnerRenderer`.
3. Para cada ID que ainda **não** está em `social_posts`: `HEAD
   youtube.com/shorts/ID` responde `200` para short e `303` para vídeo comum;
   se não for short, `GET watch?v=ID` separa `"isUpcoming":true` (em espera),
   `"isLive":true` (live) e o resto (vídeo). O resultado final fica em cache
   em memória por ID: é imutável. Erro de rede na classificação vira
   **vídeo**: errar o rótulo é melhor que não avisar.
4. Filtra pelos tipos da conta e anuncia em ordem cronológica, com a linha
   gravada antes do envio.

Custo por conta por passada: um GET pequeno (RSS), um GET de ~350 KB gzip
(a sonda de live) e nada mais, já que a classificação só roda para ID novo.
Todas as requisições ao YouTube levam o cookie `SOCS=CAI`, que evita a parede
de consentimento de IPs europeus.

Regras que caem daí:

- A **primeira passada de uma conta nova não anuncia nada**: ela grava em
  `social_posts` o que já existia e passa a avisar do próximo post em diante.
  Sem isso, adicionar um canal antigo despejaria o feed inteiro no canal.
- **Live agendada não é anunciada.** Fica em espera (não entra em
  `social_posts`, não é cacheada) e é reavaliada a cada passada até virar
  live de verdade. Premiere se comporta igual e é anunciada como live.
- **Live que terminou não vira "vídeo novo".** O VOD tem o mesmo `videoId`, e
  a unique em `social_posts` já bloqueia.
- **`social_posts` não tem retenção.** Podar a linha faria o vídeo antigo que
  ainda está no feed voltar a ser "novo" e ser anunciado outra vez. Foi um
  bug real da v1, com retenção de 90 dias.

**Cadastro.** O campo é um só e aceita a URL da barra de endereços, o
`@handle` ou o `UC…` direto; `POST /social/resolve` (Bearer, como toda rota)
devolve `{ channelId, title, handle, avatarUrl }` ou 400 com mensagem em
pt-BR, e o painel mostra o cartão do canal antes de salvar. `/social add` faz
o mesmo pelo Discord. O que fica guardado é sempre o `UC…`.

**Template** por conta, com as variáveis `{title}`, `{url}`, `{author}`,
`{thumbnail}`, `{platform}`, `{kind}` e `{headline}`; texto ou embed, no mesmo
motor de templates das boas-vindas (§5.5). Menção opcional a cargos, com
`allowedMentions` restrito a eles: `mention_role_ids` (até 5) vale para vídeo e
short, `live_mention_role_ids` (até 5) para live. Não há fallback entre as duas
listas: vazia é não pingar naquele tipo, e é isso que deixa quem só quer o aviso
da live fora do ping de cada short. Um cargo pode estar nas duas (o de quem veio
pelo canal, por exemplo). O anúncio de teste escolhe os cargos pelo tipo
testado, com a mesma regra. Duas decisões que o desenho não fixava:

- `{headline}` existe porque um texto só precisa servir aos três tipos:
  "publicou um vídeo novo", "publicou um short", "está ao vivo". Sem ela o
  template padrão fica errado em pelo menos um dos casos.
- `{thumbnail}` existe como variável de texto, mas a capa entra mesmo como
  **imagem do embed**, e só quando o template não define uma imagem própria.
  Um card com a capa é o que dá ao anúncio a cara que se espera.

**Futuro: outras plataformas.** Twitch, Instagram e TikTok foram removidos do
código na v2 (nenhum usuário, muita superfície). O enum `social_platform` do
Postgres mantém os quatro valores (remover valor de enum exige recriar o
tipo). Quando uma delas voltar, entra como um serviço ao lado do YouTube, sem
registro genérico, e com os pré-requisitos já levantados na v1: **Twitch** por
Helix `streams?user_login=…` com App Access Token (client credentials),
preferido sobre EventSub por não exigir rota pública de callback;
**Instagram** pela Graph API da Meta (`/{ig-user-id}/media`), que exige conta
Business ou Creator vinculada a uma Página, um app na Meta e as permissões
`instagram_basic` + `pages_show_list` aprovadas; **TikTok** sem API pública
que sirva (a Content Posting API é de publicação, a Display API exige
aprovação comercial), ou seja, melhor esforço e aviso explícito no painel.

### 5.9 Guild como código (CLI)

Configurar um servidor pelo painel custa uma chamada por clique. Para trabalho
em escala (montar um servidor do zero, replicar uma estrutura em outro, ou
revisar em PR o que mudou na hierarquia) existe um caminho declarativo.

Um arquivo `infra/discord/<slug>/guild.yaml` descreve **cargos, categorias,
canais e permissões de canal**. O comando `pnpm guild plan` compara esse
arquivo com o estado real da guild e imprime a diferença; `pnpm guild apply`
executa. O pacote é `packages/guild-config`.

Requisitos que o desenho tem de cumprir:

- **Nenhum ID no arquivo.** Todo alvo é referenciado por nome; a resolução
  nome → ID acontece durante o apply, contra a guild. É o que permite versionar
  o arquivo num repositório público e aplicar o mesmo spec em servidores
  diferentes. `GUILD_ID`, `ACTOR_ID` e o token ficam num `.env` por servidor,
  fora do versionamento.
- **Idempotência.** Rodar duas vezes seguidas não produz efeito na segunda.
  Só as permissões que o produto conhece (§`PERMISSION_BITS`) entram na
  comparação: comparar o bitfield inteiro faria todo apply reescrever todo
  cargo, já que o bot preserva os bits que não conhece.
- **Nada é apagado por padrão.** Remoção exige `--allow-delete`, sai num bloco
  separado do plano e pede confirmação digitada que o `--yes` não pula: apagar
  canal leva as mensagens junto.
- **Mesmo caminho de escrita do painel.** O CLI é cliente da API do bot (§5.7),
  não do Discord. Herda `actorId`, checagem de nível, hierarquia, validação Zod
  e rate limit sem reimplementar nada.
- **Respeitar o rate limit.** Pausa configurável entre chamadas (padrão 120 ms)
  e uma repescagem quando a API devolve 503 com `retryAfter`.

`pnpm guild import` faz o caminho inverso (lê o servidor e escreve o
`guild.yaml` que o descreve) e verifica a si mesmo: depois de escrever, relê o
arquivo e monta o plano, que tem de sair vazio. Sem isso, adotar um servidor que
já existe significaria transcrever tudo à mão, e qualquer esquecimento viraria
diferença falsa na primeira execução.

Fora de escopo na v1: emojis, stickers, eventos agendados, webhooks, fóruns,
palcos e tópicos; e posição de canal (a API não expõe, então a ordem é a de
criação).

### 5.10 Bot público: convite, aprovação e demonstração

Desde a v1.3 o Goodbot é público: qualquer pessoa pode convidá-lo. Quem o bot
atende **não** é uma variável de ambiente, é a tabela `guild_registry` (§8), e
todo servidor tem um estado:

| Status     | Como chega                                       | O bot atende?    |
| ---------- | ------------------------------------------------ | ---------------- |
| `pending`  | convite por `invite.`: espera aprovação          | não, fica calado |
| `approved` | o dono do bot aprovou no painel dele (§9.3)      | sim, sem prazo   |
| `demo`     | convite por `demo.`: aprovado na hora            | sim, por 1 hora  |
| `blocked`  | o dono do bot bloqueou                           | não, e ele sai   |
| `expired`  | passou 1 semana em `pending` sem decisão         | não, e ele sai   |

Não atender é **estado válido**: o bot fica na guild e ignora tudo: nem
interação, nem evento do gateway. Isso é requisito de privacidade, não detalhe
de implementação: sem o filtro no caminho do evento, um servidor que nunca foi
aprovado alimentaria o `message_cache` (com conteúdo de mensagem) e as
estatísticas.

**Os dois links de convite são dois hostnames** (`invite.` e `demo.`), e não a
URL crua do Discord, porque **o convite do Discord não diz ao bot por onde a
pessoa veio**. O link passa pelo nosso domínio, que redireciona ao OAuth com
`redirect_uri` de volta para nós; o Discord devolve o `code` na nossa URL, a
troca prova a instalação e diz quem convidou, e o hostname diz qual dos dois
fluxos foi usado. Exigências:

- O `state` do OAuth é **assinado** (HMAC-SHA256 com o `AUTH_SECRET`) e vale
  15 minutos. Sem assinatura, alguém troca `state=pending` por `state=demo`
  (ou por um status que nem devia existir ali) e se aprova sozinho. O
  callback ainda confere se o fluxo do `state` bate com o hostname que o
  recebeu: divergir é `state` reaproveitado.
- O `state` é assinado no **clique**, não ao renderizar a página: uma aba
  esquecida aberta não gera `state` vencido.
- A tela de entrada tem **botão**, e não redireciona sozinha: a pessoa precisa
  saber que a demo tem prazo antes de instalar, e um link que dispara o OAuth
  ao ser aberto seria consumido pela prévia que o Discord ou o WhatsApp geram
  quando alguém cola a URL.
- **Install Link = `None`** no Developer Portal. Com o link de instalação do
  Discord ligado, o botão "Add App" do perfil do bot instalaria sem passar por
  nenhum dos dois fluxos, e esse servidor entraria sem classificação.

**A corrida do `guildCreate`.** O Discord adiciona o bot no clique em
"Autorizar", então o evento do gateway chega ao bot **antes** de o callback
trocar o `code`: a linha do registro já nasceu `pending` quando o fluxo do
convite vai gravar. Um upsert que nunca sobrescreve, como era até a v1.4,
fazia o link da demonstração entregar um servidor `pending`: demo nenhuma,
nunca. Por isso o convite tem uma escrita própria (`claimInvitedGuild`), que
**assume** a linha quando ela é `pending`, `expired` ou uma `demo` já gasta, e
não toca em `approved`, `blocked` nem numa demo em curso. A mesma escrita é o
que permite reabrir um convite recusado pelo prazo.

**A demonstração** dura 1 hora, é fixa (não é negociável por servidor: seria um
plano gratuito, que não é o que a demo é) e **não se renova**: quem já teve a
sua entra na fila de aprovação como qualquer um. O que impede a renovação é o
`demo_ended_at`, não o status: a linha volta a ser `pending` quando o servidor
é convidado de novo, mas prazo novo só sai para quem nunca gastou o seu.

**Os avisos a quem convidou.** Toda mudança de estado é dita **no privado de
quem clicou no convite** (`invited_by`), porque é a única pessoa que a decisão
afeta e a única que pode agir sobre ela:

| Quando                     | O que o aviso diz                                      |
| -------------------------- | ------------------------------------------------------ |
| entrou em demo             | está funcionando, até que horas, que vale uma vez       |
| faltam 10 min para o fim   | o prazo e o link para pedir a aprovação                 |
| a demo acabou              | nada foi apagado, e como ficar de vez                   |
| entrou na fila             | o bot está calado **de propósito**, e o prazo da fila   |
| aprovado                   | já está atendendo, sem prazo, com o link do painel      |
| recusado ou bloqueado      | o motivo escrito pelo dono do bot, quando houver        |
| recusado pelo prazo        | não é bloqueio, e convidar de novo funciona             |

O aviso de 10 minutos é **só** essa DM: uma contagem regressiva no canal do
servidor é barulho para todo mundo que não decide nada. A despedida da demo
continua **também** no servidor, porque aí o fato é público: o bot está
saindo, e quem o viu moderando merece saber por quê.

A entrada não pode ser avisada pelo bot sozinho: quando o `guildCreate` chega,
ele não sabe por qual link a pessoa veio (a corrida acima). Quem sabe é o
painel, e é ele que pede o aviso certo ao bot (`POST /registry/:guildId/notice`).

**A recusa por inatividade.** Um convite parado em `pending` por
`PENDING_EXPIRY_MS` (**1 semana**) é recusado sozinho: o bot avisa no servidor,
avisa quem convidou, sai, e a linha vira `expired`. A razão é a mesma da
expiração da demo (bot mudo parado num servidor é a pior versão possível),
só que aqui ele é mudo desde o primeiro minuto, e quem convidou não tem como
distinguir "ainda não aprovaram" de "instalei errado". O prazo transforma
silêncio indefinido em resposta.

`expired` **não** é `blocked`: a linha continua contando a história na fila do
painel, mas o mesmo servidor pode ser convidado de novo a qualquer momento, e
aí o relógio recomeça. Quem está na fila **não** adia a recusa clicando no
próprio link de novo: o relógio só reinicia para quem estava fora dela.

E a regra que fecha o ciclo: **estar no servidor e estar na fila são a mesma
coisa.** A reentrada do bot num servidor `expired` já o devolve a `pending`, no
próprio `guildCreate`, sem depender de o callback do convite chegar ao fim.
Sem isso um reconvite interrompido no meio deixaria o bot dentro de um servidor
`expired`: mudo, atendido por ninguém e fora do alcance de todo job, que é
exatamente o estado que esta seção existe para acabar.

**Teto a manter à vista: 100 servidores.** Acima disso, o Discord exige
verificação da aplicação para as intents privilegiadas (`GuildMembers`,
`MessageContent` e `GuildPresences`), das quais automod, logs e o aviso
automático do squad dependem (§7.3, §10). O modelo com
aprovação é o que segura isso, e a demo que expira sozinha também.

### 5.11 Buscar squad

Quem quer jogar agora precisa achar gente agora. O módulo `squads` não guarda
perfil, agenda nem grupo fixo: ele mostra **quem está buscando** e **onde já
tem sala aberta**, e deixa o Discord ser o estado. O cargo é do Discord, a sala
é do Discord e a agenda é o evento agendado do Discord. O bot liga as peças e
apaga o que sobra.

Não há match. Ninguém é proposto, pontuado nem votado: quem entra numa sala
entra porque quis, e quem sai leva a sala de volta ao nada quando ela esvazia.
O módulo serve a um jogo por vez, o dos `gameNames` (abaixo), mas nada nele é
escrito para um jogo só.

**Dois cargos.** São cargos comuns, criados pela staff (à mão ou no
`guild.yaml`); o bot só os lê pelo id configurado e nunca os cria. Nenhum dos
dois dá permissão alguma. O cargo do bot precisa estar **acima** deles na
hierarquia (§10), senão ligar e desligar falha com `BOT_ROLE_HIERARCHY`.

- `Buscando Squad` (`searchRoleId`), com `hoist` ligado: a lista de membros
  mostra num bloco à parte quem quer jogar agora. É a única marca de "estou
  buscando".
- `Sem Aviso de Squad` (`optOutRoleId`): quem tem nunca recebe o aviso
  automático (abaixo), e continua livre para ligar a busca à mão.

**Ligar a busca.** Dois gatilhos, um efeito: a pessoa ganha `Buscando Squad`.

1. **Automático.** O bot escuta a presença (`GuildPresences`, intent
   privilegiada, §10). Quando a atividade de alguém passa a ser um dos
   `gameNames` (padrão `HELLDIVERS™ 2`, comparado sem `™` e sem diferenciar
   caixa), manda **uma DM** com três botões: **BUSCAR SQUAD**, **AGORA NÃO** e
   **NÃO AVISAR MAIS**, que dá o cargo `Sem Aviso de Squad`. Só o clique em
   BUSCAR SQUAD liga o cargo: ver o jogo aberto nunca liga sozinho. É DM, e não
   mensagem efêmera, porque a efêmera só existe como resposta a uma interação, e
   abrir um jogo não gera nenhuma.
2. **Manual.** O botão **BUSCAR SQUAD** do painel (abaixo) ou `/squad buscar`,
   que alternam: quem tem o cargo o perde, quem não tem o ganha. É o único
   caminho de quem joga em console, sem rich presence, e o de quem tem o aviso
   desligado.

O aviso é pulado, em silêncio, quando a pessoa já tem `Buscando Squad`, tem
`Sem Aviso de Squad`, está numa sala de squad ou já recebeu um aviso nas
últimas 6 horas (`LFG_PROMPT_COOLDOWN_HOURS`, constante em `shared`, e o AGORA
NÃO conta como aviso recebido). Esse relógio é memória: um restart o zera, e o
custo é uma DM a mais. DM fechada não quebra nada: o bot não avisa e segue. O
`custom_id` do botão da DM leva o `guildId`, porque a DM não pertence a servidor
nenhum, e o clique confere de novo que a guild é atendida (§5.10), que o módulo
está ligado e que a pessoa ainda é membro dela.

**Desligar a busca.** Três caminhos:

- o toggle manual;
- **sair da voz**: se a pessoa estava em algum canal de voz da guild e sai de
  todos, o cargo cai depois da janela de tolerância;
- **expirar**: a pessoa ligou a busca e não entrou em voz em
  `searchTtlMinutes` (padrão 120), então o cargo cai. Entrar em voz cancela
  esse relógio, e a partir dali vale a regra de sair da voz.

Estar numa sala **não** desliga a busca: sala com vaga ainda quer gente. E
desligar o módulo só faz o bot parar de reagir: cargo e sala que já existem
ficam como estão, e a reconciliação de quando ele voltar a ligar cuida deles.

**Janela de tolerância.** O Discord manda o mesmo `voiceStateUpdate` para quem
sai do canal de propósito e para quem perde a conexão (queda de internet, PC
que desliga sozinho, jogo que trava), e o bot não tem como diferenciar na hora:
só esperar. Tirar o cargo e apagar a sala no mesmo segundo puniria a queda de
quem volta em meio minuto. Por isso `graceMinutes` (padrão 2, de 0 a 10): sair
da voz só vale depois desse tempo, e voltar dentro dele cancela. A janela vale
para o cargo e para a sala.

O relógio da janela mora em memória, sem tabela. Depois de um restart, e ao
ligar o módulo, o bot reconcilia: lista quem tem `Buscando Squad` e não está em
voz, e as salas da categoria que estão vazias, e passa a contar a janela **do
zero** para todos. O custo é aceito e dito: um cargo ou uma sala pode durar até
uma janela a mais do que duraria sem o restart.

**Salas de voz efêmeras.** O canal de voz fixo **➕ Criar Squad**
(`createChannelId`), criado pela staff, funciona como *join-to-create*: quem
entra nele ganha uma sala nova na `categoryId` e é movido para ela na hora. A
sala se chama `Squad <nome>`, com o nome do primeiro livre na ordem do
**alfabeto grego**: Alfa, Beta, Gama, Delta, Épsilon, Zeta, Eta, Teta, Iota,
Kapa, Lambda, Mi, Ni, Csi, Ômicron, Pi, Rô, Sigma, Tau, Ípsilon, Fi, Qui, Psi e
Ômega (24 nomes, o teto de salas por servidor). O teto de gente é `roomSize`
(padrão 4, de 2 a 10), aplicado pelo `userLimit` do canal, então quem decide que
a sala lotou é o Discord. A sala herda as permissões da categoria, e o bot nunca
a renomeia: o Discord só deixa renomear canal duas vezes a cada dez minutos.

A sala **some** quando esvazia e a janela de tolerância passa sem ninguém
voltar. O canal de criar nunca é apagado. Sem permissão, com o teto de 500
canais do servidor (§11) ou com os 24 nomes em uso, o bot **não cria e não
move**: a pessoa continua no canal de criar e o motivo sai no log, porque uma
sala que nasce sem poder receber ninguém é pior que nenhuma.

Sem tabela, quem diz que um canal é sala do módulo é o **nome e a categoria**:
o bot só apaga canal de voz da `categoryId` cujo nome é `Squad <nome do pool>`
e que não é o `createChannelId`. A consequência é uma regra para a staff: a
categoria pertence ao módulo, e um canal de voz feito à mão ali com esse
formato de nome seria apagado ao esvaziar.

**Painel fixo.** Uma mensagem no `panelChannelId`, fixada e editada pelo bot, que
lista as salas com gente, em tempo real:

```
🟢 Squad Alfa · 1/4 · clique pra entrar
🔴 Squad Beta · 4/4 · lotada
```

O nome é a menção do canal de voz, que no Discord é clicável e entra na sala.
Sala vazia, na janela de tolerância, não aparece. Sem nenhuma sala, o painel
diz que não há ninguém e aponta o **➕ Criar Squad** e as jogatinas marcadas
(abaixo). Os botões da mensagem são **BUSCAR SQUAD** (o toggle), **SEM AVISO**
(o toggle do `Sem Aviso de Squad`) e **MARCAR JOGATINA**. A regra do módulo é
**botão antes de comando**: toda ação está num botão de uma mensagem que o bot
já deixou na frente da pessoa, e o comando é atalho, nunca o único caminho.

O painel é reeditado a cada `voiceStateUpdate` que mexe numa sala do módulo,
**coalescido** (uma edição por poucos segundos), porque o Discord limita edição
de mensagem por canal e uma noite movimentada estouraria o limite. Edição que
falha não derruba nada: a mudança seguinte tenta de novo. Mensagem apagada é
publicada de novo na mudança seguinte, sem republicar por falha passageira do
Discord, porque duas mensagens fixas são piores que uma desatualizada. Fixar
exige `PinMessages` no canal; sem ela a mensagem fica no ar sem pin e o log
avisa. O painel também se refaz no boot, lendo a categoria: a lista de salas é
o estado do Discord, nunca uma cópia. Quem publica ou atualiza é `/squad
painel` (admin) ou o botão do painel web (§6.2), e o id da mensagem fica em
`panelMessageId`, que é do bot.

**Sem ninguém buscando: a jogatina agendada.** Não existe agenda própria.
**MARCAR JOGATINA** (botão do painel ou `/squad agendar`) abre um modal com um
campo só, o "quando", lido no fuso da guild (`guild_settings.timezone`) por
`parseWhen`, em `shared`: `hoje 21h`, `amanhã 20h`, `sex 22h`, `16/09 21h`. `agora`
não vale aqui, porque esse caso é uma sala. O erro sempre ensina, com exemplos,
e horário que já passou sugere o do dia seguinte. O bot cria um **evento
agendado nativo** (`guild.scheduledEvents.create`) do tipo voz, apontando para o
canal de criar, para que o "Tenho interesse" caia onde a sala nasce, com nome
`Jogatina de <nome de quem marcou>`, a descrição dizendo quem marcou e o fim em
`LFG_EVENT_HOURS` (3, constante em `shared`) depois do início. **O Discord
cuida do RSVP e do lembrete**; o bot não manda mensagem a ninguém e não guarda
nada.

O painel lista até 3 jogatinas futuras, lidas na hora dos eventos da guild cujo
criador é o próprio bot (é assim que o módulo reconhece os seus, sem tabela).
Como o criador é o bot, quem marcou não edita nem cancela pelo Discord: isso é
de quem tem `ManageEvents`, e a descrição diz quem marcou para a staff saber a
quem perguntar. O teto é de 10 jogatinas futuras do bot por servidor
(`LFG_MAX_EVENTS`); passando, o modal recusa com o motivo, para o botão não virar
spam de evento.

**Falhas e permissões.** Tudo é conferido antes. Onde há interação (botão,
comando), a falta de permissão vira um erro efêmero que diz o que falta
(`UserFacingError`); onde não há (a sala nascendo, o cargo caindo por tempo), o
motivo sai só no log. O módulo usa `ManageRoles` (os cargos, com o do bot acima
deles), `ManageChannels` (criar e apagar sala), `Connect` e `MoveMembers`
(mover para a sala nova), `SendMessages`, `EmbedLinks` e `PinMessages` no canal
do painel, `ManageEvents` (a jogatina) e a intent `GuildPresences` (§10).

**Estado e escopo por servidor.** O módulo é configurado por guild
(`module_configs`, §8) e tudo o que ele lê ou escreve leva o `guildId`: o
cargo, a categoria e o canal de criar de um servidor nunca alcançam os de outro.
O estado em si vive no Discord (cargo, canal, evento) e em memória (as janelas e
o relógio do aviso), e é reconstruído por leitura no boot.

**O que saiu.** Das v1.5 a v1.7 saíram o perfil por jogo, a grade semanal, as
perguntas, o match, a proposta em thread privada, o squad fixo com canal
privado e voice emprestado de um pool, a votação de entrada, a jogatina
(`/bora`, REMARCAR, convidado avulso, chamada pública), o histórico, os números
de tempo de jogo e o relatório de fim, com as nove tabelas do módulo. **Não há
migração**: os canais que squads antigos deixaram no Discord viram canais
comuns, e limpá-los é da staff. Botão de mensagem antiga do módulo, que o bot
não trata mais, responde em efêmero que aquele fluxo acabou, em vez de falhar
mudo. Tempo de jogo e histórico de squad não existem mais: nenhuma presença é
gravada.

Fora do escopo: perfil, agenda semanal e match de qualquer tipo; histórico e
estatística de jogo; sala privada, com senha ou com dono, e comandos de sala
(renomear, trancar, expulsar); convidar quem é de fora; agendamento recorrente;
cancelar ou editar o evento pelo bot; e mais de um canal de criar por servidor.

## 6. Requisitos funcionais: Painel

Acesso: login com Discord OAuth2 (Auth.js). Após login, o painel verifica, na
**guild da URL**, se o usuário é membro dela **e** tem permissão
`Administrator` **ou** `ManageGuild` **ou** um dos cargos listados em
`dashboard_access_roles`, e se essa guild é atendida pelo registro (§5.10).
Caso contrário → "Acesso negado". Sessão JWT
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
- **Sem atualização automática.** A tela é carregada quando alguém abre ou
  clica no botão de atualizar da topbar; não há poll de fundo. O botão invalida
  o cache da guild antes de revalidar, então clicar sempre traz dado fresco. Os
  blocos pesados ficam em cache de 5 minutos, o que torna navegar entre telas
  barato. A exceção é a atividade recente, sempre ao vivo.

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
- **Squads** (§5.11), uma página só, sem abas. Toggle "módulo ativo" e, no
  topo, o painel da mensagem fixa (publicar ou atualizar), que passa pela API do
  bot. Depois, os campos do config: cargo de busca, cargo de sem aviso, canal do
  painel, categoria das salas, canal de criar (voz), tamanho da sala (de 2 a 10,
  padrão 4), janela de tolerância em minutos (de 0 a 10, padrão 2), expiração da
  busca em minutos (padrão 120) e os nomes de jogo que disparam o aviso
  automático (lista, padrão `HELLDIVERS™ 2`). Cada seletor de cargo e de canal
  lê do bot, e o de canal filtra o tipo (texto para o painel, categoria, voz
  para o de criar). Sem tabela, sem jogos, sem lista de jogadores: a tela não
  lê nada do banco além do próprio config. Salvar o config **preserva o
  `panelMessageId`**, que é do bot: um formulário aberto antes de uma
  publicação levaria o id velho, e a publicação seguinte mandaria uma segunda
  mensagem em vez de editar a primeira.
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

### 6.6 Perfil do bot por servidor

Cada servidor escolhe como o bot aparece **nele**: apelido, foto de perfil,
capa e bio. O Discord guarda os quatro no *membro* (`PATCH
/guilds/{id}/members/@me`), não na aplicação, então são de fato por servidor, e
o que ficar vazio cai no perfil global do bot.

- Tela `/g/[guildId]/perfil-do-bot`, só `admin`, no grupo SERVIDOR da
  navegação.
- Imagens seguem a mesma regra do ícone do servidor (§6.3): PNG, JPEG, GIF ou
  WEBP, até 8 MB, enviadas como data URL e validadas pelo mesmo schema no
  painel, na action e na rota do bot. Os três estados valem aqui também:
  ausente não mexe, `null` remove, data URL troca.
- O apelido é o único campo com permissão atrás: sem `CHANGE_NICKNAME` no
  cargo do bot, a rota recusa antes de falar com o Discord e a tela explica o
  porquê. Avatar e capa continuam editáveis nesse caso.
- **Apelido, foto e capa não têm tabela.** A fonte de verdade é o Discord: o
  bot lê do próprio `GuildMember`, porque uma cópia só poderia divergir. A
  auditoria (§6.5) guarda o antes/depois como URL do CDN, nunca a imagem.
- **A bio é a exceção, e é espelho.** O Discord aceita escrevê-la e não a
  devolve em endpoint nenhum: não está no objeto de membro. Sem uma cópia o
  painel não teria como mostrar a que está valendo, então ela mora em
  `guild_settings.bot_bio`, gravada **depois** de o Discord aceitar. Quem
  alterar a bio por fora do painel deixa os dois fora de sincronia, e o painel
  não tem como perceber.
- Trocar avatar é caro no rate limit do Discord. A escrita só acontece quando
  alguém salva a tela; nada é reaplicado no boot nem ao entrar num servidor.

## 7. Requisitos não funcionais

### 7.1 Multi-server

- Toda tabela tem `guild_id` (snowflake como `bigint`/`text`) e todo índice
  composto começa por ele.
- Quem o bot atende é o **registro** (`guild_registry`, §5.10), não o
  ambiente: o `GUILD_IDS` sobrou como **semente** (no boot cria a linha
  `approved` de quem ainda não tem uma; quem já tem não é tocado) e deixou de
  ser obrigatório. A fronteira vale nos **dois** caminhos de entrada, a
  interação (`lib/interaction.ts`) e o evento do gateway (`lib/loader.ts`),
  e o filtro do evento fica no carregador, não em cada handler, para handler
  novo já nascer filtrado. Estar numa guild que o bot não atende é estado
  válido: ele fica calado nela.
- No `ready`, cada guild **atendida** é preparada por vez: upsert, aquecimento
  da config e registro dos guild commands (um hash por guild, então
  acrescentar um servidor não re-registra os outros). Guild em que o bot está
  sem estar no registro ganha linha `pending`; guild bloqueada, ele deixa.
- Um recurso é do **processo** e não da guild: o intervalo de flush das
  estatísticas. Com várias guilds vale o menor intervalo, e a guild mais
  exigente é atendida. O LRU do cache de mensagens **não** é mais do processo:
  cada canal guarda até o `messageCache.perChannel` da própria guild, e canal
  sem mensagem nova há 1 h sai da memória (o conteúdo segue no banco). Antes
  valia o maior valor entre as guilds, e um servidor que pedisse 1000 por canal
  multiplicava a RAM de todos.
- O painel guarda um nível de acesso **por guild** na sessão
  (`Record<guildId, {level, checkedAt}>`). Um nível único seria furo de
  permissão: alguém pode ser dono de um servidor e nem estar no outro. Quem
  decide acesso é sempre a guild da URL (`/g/[guildId]/...`), nunca "a" guild
  da sessão; guild fora do registro é negada antes de consultar o bot. Toda
  action de escrita recebe a guild no primeiro argumento: nenhuma resolve
  sozinha "a" guild.
- A lista que o painel oferece é o registro **∩** o que este usuário pode
  abrir. Com servidores de terceiros, mostrar o registro inteiro seria
  vazamento: quem entra num servidor leria o nome de todos os outros.
- A barra lateral mostra o nome real de cada servidor e oferece a troca quando
  há mais de um; com mais de um acessível, a raiz manda para o seletor, e com
  um só vai direto para ele.

**Limite prático.** O cache de membros tem teto **por guild**
(`MEMBER_CACHE_MAX`, 200) e sweeper de hora em hora, e o `ready` não carrega
mais a lista completa de ninguém: a RAM cresce com o número de servidores, não
com a soma dos membros deles. Em troca, quem lista membros pergunta ao Discord
(lista, busca por prefixo ou `fetchMember`) e a contagem de membros por cargo é
exata só até 5.000 membros: acima disso o campo não vai, e o painel escreve
"—". O consumo real está no `rssBytes` do `/health`; o sinal de alarme é ele
voltar a crescer em linha reta com o número de servidores.

**Capacidade.** Os dois limites que param o bot inteiro são a RAM do container
(384 MB) e a cota do Supabase (500 MB); o que mais pesa nos dois é o cache de
mensagens, que guarda o texto de toda mensagem por 7 dias. As linhas de aviso
moram em `@goodbot/shared` (`BOT_MEMORY_BUDGET_BYTES` 300 MB,
`DATABASE_WARNING_BYTES` 400 MB) e valem nos dois lugares que as leem: a tela
Saúde do `/admin`, que marca APERTADO, e o `CapacityJob` do bot, que mede a cada
15 min e alerta no webhook ao cruzar a linha (repete uma vez por dia enquanto
continuar acima). A alavanca é o próprio `/admin`: a tabela de uso ordena os
servidores por mensagens guardadas e liga ou desliga o cache de cada um. A
escrita é a mesma config da tela de logs do servidor, com linha na auditoria
dele.

### 7.2 Performance no free tier

- **VM (Oracle E2.1.Micro, 1 OCPU / 1 GB, x86_64)**: roda só `bot` e
  `caddy`. Orçamento: bot ≤ 300 MB RSS (`mem_limit: 384m`), caddy ≤ 50 MB,
  sobrando ~500 MB para o sistema. Swap de 2 GB configurado no host, porque
  1 GB não perdoa pico. A CPU da E2.1.Micro é **1/8 de OCPU** com rajada: aguenta
  pico, não carga alta contínua. Quem acompanha o orçamento é o `CapacityJob`
  (§7.1).
- **Painel (Vercel)**: `output` padrão (não `standalone`); server components
  com `fetch` paralelo; nada de trabalho pesado por request. Cold start
  importa: manter dependências do server enxutas.
- **Postgres (Supabase free)**: 500 MB de armazenamento. As retenções do §8
  já cabem nisso com folga; `shared_buffers` é do provedor, não nosso.
  Painel conecta pelo **pooler** (pgBouncer) porque funções serverless abrem
  muitas conexões curtas; o bot conecta direto, com pool de no máximo 5.
- Imagem `linux/amd64` para o bot; base `node:22-alpine`.
- Stats agregadas em memória e flush em lote (§5.6); nunca 1 INSERT por
  mensagem.
- Cache de config no bot com TTL de segurança (5 min) além da invalidação
  explícita, agora ainda mais importante, já que cada leitura do painel
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
level)`. A guild conferida é sempre a que vai ser lida ou escrita, e ela
  chega explícita: da URL nas páginas, no primeiro argumento nas actions, em
  `?guildId=` nas rotas de apoio, que devolvem 404 sem o parâmetro em vez de
  adivinhar.
- **Convite (`invite.` / `demo.`)**: o `state` do OAuth é assinado com HMAC do
  `AUTH_SECRET` e vale 15 min; o `guild_id` da query **não** é confiável (é o
  `code` trocado com o Discord que prova a instalação); o `redirect_uri` é
  derivado do `AUTH_URL`, nunca do header `Host`, que é do cliente. Detalhe do
  fluxo em §5.10.
- **Painel do dono (`admin.`)**: `OWNER_DISCORD_ID` conferido nos dois lados,
  painel e bot (§9.3). O cookie de sessão sai com `domain` explícito para
  valer entre os hostnames irmãos; entrar acontece num lugar só, o `/login` do
  host do painel, que é o único `redirect_uri` registrado no Discord.
- **API do bot (exposta)**: desde a v1.1 o painel roda fora da VM, então a
  API do bot é publicada pelo Caddy num subdomínio dedicado
  (`bot.<dominio>`), **só** com TLS. Defesas obrigatórias, porque o token
  passa a ser a única barreira: token longo aleatório (`openssl rand -hex
32`), comparação timing-safe, rate limit 60 req/min por IP **e** 100/min por
  rota (memória), body ≤ 256 KB, Zod em toda entrada, sem CORS (nenhum
  `Access-Control-Allow-Origin`), sem listagem de rotas, respostas de erro
  sem stack. O container do bot não publica porta no host: só o Caddy
  alcança `bot:3001` pela rede do Compose. **Exceção ao teto de corpo**: as
  rotas que recebem imagem (configurações do servidor, perfil do bot na guild,
  capa de evento, emoji e sticker) aceitam 12 MB, porque a imagem viaja como
  data URL e 8 MB (o limite do Discord) viram ~11 MB em base64. Toda outra rota
  continua em 256 KB. **O teto vale em dois lugares**, e os dois precisam
  concordar: o `bodyLimit` do Hono decide por rota e método, e o `request_body`
  do Caddy decide por caminho, antes de o corpo chegar ao container. Caddy com
  um teto só, como esteve até a v1.4, derruba o upload com 413 sem o bot nunca
  ver o pedido.
- **Segredos**: só via `.env` na VM (nunca commitado; `.env.example` sim),
  GitHub Secrets para a CI e variáveis de ambiente do projeto na Vercel. O
  `INTERNAL_API_TOKEN` existe nos três lugares e é rotacionado junto. Desde que
  o painel passou a ser publicado pela CI (§7.5), os Secrets incluem também
  `VERCEL_TOKEN`, `VERCEL_ORG_ID` e `VERCEL_PROJECT_ID`; as variáveis de
  ambiente do painel continuam só no cofre da Vercel, de onde o job as puxa.
- **Web**: CSP restritiva (self + fonts locais), sem `unsafe-inline` exceto
  o script de tema com nonce; CSRF coberto por server actions (origin check)
  e cookie `SameSite`; headers de segurança configurados no `next.config.ts`
  (não mais no Caddy, que só atende a API do bot).
- **Discord**: bot com o mínimo de permissões (ver §10); intents privilegiadas
  `GuildMembers` e `MessageContent` (necessárias para automod/logs) e, desde a
  v1.8, `GuildPresences` (só para o aviso automático do squad, §5.11). O bot
  não guarda presença: o cache de presença fica desligado e o evento é lido e
  descartado.
- **Postgres gerenciado**: conexão só por TLS (`sslmode=require`); usuário da
  aplicação sem privilégio de superusuário; senha só em segredo; painel usa a
  string do **pooler** (pgBouncer, porta 6543) e o bot usa a conexão direta
  (5432), que suporta pool longo; backups do provedor + `pg_dump` próprio
  (§7.5).
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
  boot. Deploy manual usa `pnpm --filter @goodbot/db db:migrate` com a
  `DATABASE_URL` de produção.
- **O painel também sai pela CI** (v1.4). Até então ele era publicado pela
  integração git da Vercel, que roda em paralelo com o workflow: num push que
  mexia no schema, o painel novo ia ao ar enquanto o `migrate` ainda rodava e
  falava com o banco velho, derrubando toda tela logada até a migration
  terminar. Agora `apps/web/vercel.json` desliga o deploy automático da `main`
  (`git.deploymentEnabled`) e o job `painel` publica com a CLI
  (`vercel pull/build/deploy --prebuilt --prod`) depois do `migrate`. Branch e
  PR continuam ganhando preview pela integração normal.
- **Deploy avisa antes de reiniciar o bot** (v1.7). Um job `changes` compara
  o commit da imagem no ar com o novo e classifica o deploy
  (`packages/shared/src/deploy.ts`): `none` (painel, docs, CI) não reconstrói
  nem reinicia o bot; `restart` (código), `database` (migration nova) e `infra`
  (compose, Caddy, scripts da VM) reiniciam, e antes do `up` o bot ainda no ar
  publica em cada servidor atendido um aviso de manutenção com a previsão de
  volta do tipo (~1, ~2 e ~3 min; o reinício medido na E2.1.Micro fica abaixo
  de 1 min). O bot novo, no boot, edita o mesmo aviso para "voltou" com o
  tempo fora. A chamada é a rota `POST /admin/deploy-notice` (Bearer, Zod e
  `actorId` do dono, como o resto do `/admin`), feita de dentro do container
  pelo `scripts/deploy-notice.sh`, que nunca falha o deploy. O estado mora em
  `meta` (`deploy_notice`), porque quem avisa e quem confirma são processos
  diferentes. O aviso vai para o **canal de avisos** da guild
  (`guild_settings.notice_channel_id`, configurável na página Geral do
  painel), o mesmo do broadcast do dono e do fim da demonstração. Sem escolha,
  vale o canal de sistema do Discord, e depois dele o primeiro canal de texto
  onde o bot consiga falar: é melhor avisar no lugar errado do que sumir
  calado.
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
guild_registry    (guild_id PK text, status enum(pending|approved|demo|blocked|expired),
                   invited_by, invited_at, approved_at, expires_at (só demo), left_at, note,
                   demo_warned_at, demo_ended_at)
                   idx (status), (expires_at) where expires_at not null
                   -- quem o bot atende (§5.10); `demo_ended_at` fecha a varredura do job,
                   -- e não o status, porque a linha precisa continuar dizendo "este
                   -- servidor já usou a demo dele"
                   -- `invited_at` é o relógio da fila: `expired` sai dele, e só reinicia
                   -- quando um convite reabre a linha (nunca para quem já está em pending)
guild_settings    (guild_id PK/FK, timezone, embed_color, mod_role_ids[], admin_role_ids[],
                   dashboard_access_role_ids[], log_channel_id, notice_channel_id,
                   dm_on_punish jsonb, bot_bio, updated_at)
                   -- `notice_channel_id` é onde o bot fala de si mesmo (manutenção, broadcast,
                   -- fim da demo); vazio cai no canal de sistema do Discord, como antes dele
                   -- `bot_bio` é espelho do perfil do bot na guild (§6.6): o Discord aceita
                   -- escrever a bio do membro e não a devolve, então sem cópia o painel fica cego
module_configs    (guild_id, module PK(guild_id,module), enabled, config jsonb, version, updated_at, updated_by)
                   -- módulo ∈ moderation|automod|logs|welcome|autorole|reaction_roles|tickets|tags|utilities|stats|social|squads
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
social_accounts   (id PK uuid, guild_id, platform enum(youtube|twitch|instagram|tiktok),
                   external_id (channel_id UC… do YouTube), handle, display_name, avatar_url,
                   discord_channel_id, kinds[] (video|short|live|post), template jsonb,
                   mention_role_ids[] (vídeo e short), live_mention_role_ids[] (live),
                   enabled (só humano desliga), last_checked_at, paused_until,
                   failure_count, disabled_reason (último erro), created_at, updated_at)
                   unique (guild_id, platform, external_id)
                   -- os enums guardam os valores da v1 (remover valor de enum exige recriar
                   -- o tipo), mas desde a v2 só 'youtube' é escrito em platform e só
                   -- video|short|live em kinds; 'post' é herança do Instagram (§5.8)
social_posts      (id PK, guild_id, account_id FK, external_id, kind, url, title,
                   published_at, announced_at, message_id)
                   unique (account_id, external_id)  -- a trava contra anúncio duplicado
                   -- sem retenção de propósito: podar a linha re-anuncia o vídeo que
                   -- ainda está no feed (§5.8)
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

O módulo `squads` (§5.11) **não tem tabela**. Cargo, sala e jogatina agendada
são estado do Discord, e o que sobra (as janelas de tolerância e o relógio do
aviso) é memória do bot, reconstruída por leitura no boot. O config do módulo
mora em `module_configs.config` como os dos outros: `searchRoleId`,
`optOutRoleId`, `panelChannelId`, `panelMessageId` (do bot), `categoryId`,
`createChannelId`, `roomSize`, `graceMinutes`, `searchTtlMinutes` e `gameNames`.
Até a v1.7 ele tinha nove tabelas (`squad_games`, `squad_profiles`, `squads`,
`squad_members`, `squad_proposals`, `squad_join_requests`, `squad_sessions`,
`squad_session_attendance` e `squad_session_guests`); a migration da v1.8 as
apaga, e não há dado a migrar, porque nada do modelo novo se parece com elas.

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

No módulo `squads` (§5.11), `/squad` é de `member`, com uma exceção:
`/squad painel` (publicar ou atualizar a mensagem fixa) é de `admin`. Os botões
do painel (BUSCAR SQUAD, SEM AVISO, MARCAR JOGATINA) e os da DM do aviso
(BUSCAR SQUAD, AGORA NÃO, NÃO AVISAR MAIS) valem para qualquer membro da guild,
porque cada um só mexe na própria pessoa, e o único que cria algo no servidor, a
jogatina, tem teto e é cancelado por quem tem `ManageEvents`. Cada clique
confere de novo que a guild é atendida, que o módulo está ligado e que quem
clicou é membro dela: na DM isso importa, porque o botão viaja com o `guildId`.
Pela API do bot, publicar ou atualizar o painel é de `admin`. O módulo desligado
não responde a botão nem a comando de busca.

### 9.2 No painel

| Nível   | Quem                                              | Pode                                                                              |
| ------- | ------------------------------------------------- | --------------------------------------------------------------------------------- |
| `owner` | owner do servidor                                 | tudo + gerenciar quem acessa o painel                                             |
| `admin` | `Administrator`/`ManageGuild` ou `admin_role_ids` | configurar módulos, gestão de servidor, casos, auditoria                          |
| `mod`   | `mod_role_ids` ou `dashboard_access_role_ids`     | dashboard, membros (buscar, ver casos, punir), casos (ver/editar motivo), tickets |

Checagem no servidor em cada action/route via `requireGuildAccess`. Ações de
punição pelo painel respeitam a mesma hierarquia de cargos do Discord (o bot
verifica na API interna usando `actorId`).

### 9.3 O dono do bot

Fora desta tabela, e de propósito. Quem opera o Goodbot como produto (aprovar
servidores, expulsar, avisar todos, entrar em manutenção) é uma pessoa só, e
ela é identificada por `OWNER_DISCORD_ID` no ambiente, **nunca** por cargo em
servidor nenhum: se fosse por cargo, quem administra um servidor qualquer
viraria administrador do bot inteiro.

O painel do dono vive num hostname próprio (`admin.<domínio>`) e usa a mesma
sessão do Discord; o que muda é contra o que a identidade é comparada. A API do
bot confere de novo o `actorId` de toda escrita em `/admin` contra a mesma
variável: o Bearer prova de onde veio a chamada, não quem pediu (§7.3).

Ausência da variável fecha os dois lados. Um `.env` incompleto não pode virar
painel admin aberto.

## 10. Permissões do bot no Discord (convite)

`ViewChannel, SendMessages, SendMessagesInThreads, EmbedLinks, AttachFiles,
ReadMessageHistory, ManageMessages, PinMessages, ManageChannels, ManageRoles, ManageGuild,
KickMembers, BanMembers, ModerateMembers, ViewAuditLog, ManageThreads,
CreatePrivateThreads, AddReactions, UseExternalEmojis, Connect, Speak,
MuteMembers, DeafenMembers, MoveMembers, CreateInstantInvite, ManageEvents,
ManageGuildExpressions`.

O módulo `squads` (§5.11) usa `ManageRoles` (liga e desliga os dois cargos, com
o cargo do bot acima deles), `ManageChannels` (criar e apagar a sala),
`Connect` e `MoveMembers` (mover a pessoa do canal de criar para a sala nova),
`SendMessages`, `EmbedLinks` e `PinMessages` no canal do painel, e
`ManageEvents` (a jogatina agendada). O bot não dá nem nega num overwrite o que
ele mesmo não tem. Sem elas o módulo não quebra: quem usa um botão ou comando
recebe a explicação do que falta, e o que acontece sem interação (a sala
nascendo, o cargo caindo por tempo) sai só no log. O link de convite sai da
lista `BOT_INVITE_PERMISSION_NAMES` de `packages/shared`; servidor que convidou
o bot antes de uma permissão entrar na lista precisa dá-la à mão ao cargo do
bot. `CreatePrivateThreads` e `Speak` entraram na v1.5 para o antigo módulo de
squads e seguem na lista; o módulo novo não usa nenhuma das duas.

`PinMessages` é uma permissão própria no Discord ("Fixar mensagens"), que
`ManageMessages` não cobre. Sem ela o painel do squad fica no ar sem pin, com
aviso no log.

`ManageGuild` cobre editar nome, ícone, banner e nível de verificação pelo
painel. Sem ela o bot continua funcionando: a tela
`/servidor` fica em leitura e diz o que falta, em vez de falhar no envio.

`CreateInstantInvite`, `ManageEvents` e `ManageGuildExpressions` cobrem
convites, eventos agendados, emojis e stickers pelo painel. Valem a
mesma regra: sem elas as telas `/convites`, `/eventos` e `/emojis` ficam em
leitura e explicam qual permissão falta. `ManageGuild` também é o que o Discord
exige para *listar* convites.
Sem `Administrator`. Intents: `Guilds, GuildMembers, GuildModeration,
GuildMessages, MessageContent, GuildMessageReactions, GuildVoiceStates,
GuildPresences, DirectMessages, GuildEmojisAndStickers`.

`GuildPresences` entrou na v1.8 e é a terceira intent privilegiada, com
`GuildMembers` e `MessageContent`. Só o aviso automático do squad (§5.11) a
usa. Ela precisa estar habilitada no Developer Portal **antes** de o bot subir
pedindo-a: com o Portal desligado o login falha com `Used disallowed intents` e
o bot inteiro fica fora do ar, não só o módulo. Por isso é ação do dono do bot,
e vem antes do deploy que a passa a pedir.

## 11. Riscos

Status revisado em 2026-09-07. **Feito** = mitigação implementada e
verificável no repositório; **parcial** = implementada com limitação conhecida,
descrita na linha; **manual** = depende de uma ação do operador na VM ou num
provedor, documentada em `docs/runbook.md`;
**planejado** = decidida neste documento e ainda sem código.

| Risco                                                             | Mitigação                                                                                                                                  | Status |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| Intents privilegiadas exigem verificação acima de 100 servidores  | **passou a valer com o bot público**: quem entra depende de aprovação, e a demo expira sozinha, então o número não cresce sem decisão (§5.10) | parcial: não há alerta automático ao chegar perto de 100; é item do checklist do runbook |
| Free tier da Oracle reclama instâncias ociosas                    | bot mantém CPU > 0; monitorar; não é "idle" com gateway aberto                                                                             | feito: gateway aberto + `/metrics` |
| **Capacidade Ampere A1 indisponível**                             | resolvido: v1.1 usa E2.1.Micro (x86), que não sofre com capacidade                                                                         | feito |
| **API do bot exposta na internet**                                | subdomínio próprio, Bearer de 32 bytes com comparação timing-safe, rate limit 60/min por IP, body ≤ 256 KB, sem CORS, fail2ban no Caddy (§7.3) | feito (fail2ban **manual**): `api/server.ts`, `infra/fail2ban/`; alerta a cada 50 respostas 401 numa hora |
| **Latência web → bot / web → banco**                              | Vercel e Supabase na mesma região (`sa-east-1` / GRU quando possível); painel usa cache do bot; server components paralelizam fetches       | feito: medida no card **Saúde** (`/g/[guildId]/system`) e no `goodbot_api_duration_ms` |
| **Limites do free tier da Vercel/Supabase**                       | painel de um servidor está muito abaixo dos limites; alerta de uso; migração para VM continua possível (o Compose antigo fica documentado)  | parcial: não existe alerta automático de cota; é item do checklist mensal do runbook (a Vercel e o Supabase não expõem isso no free tier) |
| **Supabase pausa projeto por inatividade (7 dias)**               | o bot mantém conexão e escrita constante; alerta se `pg_dump` diário falhar                                                                | feito: ping a cada 60s (`watchDatabase`), alerta "Postgres inacessível"; `backup.sh` alerta ao falhar |
| Regex do usuário (ReDoS)                                          | limite + timeout + validação no painel                                                                                                     | feito: `safe-regex2` no schema Zod (painel recusa ao salvar) **e** na compilação do bot; padrão ≤ 200 chars, entrada ≤ 2 000 chars |
| Perda de mensagens de log por rate limit                          | fila com coalescing (§7.4)                                                                                                                 | feito: `LogQueue`; tamanho da fila exposto no `/metrics` e no card Saúde |
| Token da API do bot vazar em log                                  | nunca logar headers; pino `redact`; rotação documentada no runbook                                                                         | feito: `logger.ts` (`redact`), rotação nos três cofres em `docs/runbook.md` |
| Auth.js + Discord: `guilds.members.read` exige o usuário na guild | tratar 403 como "acesso negado"                                                                                                            | feito: `resolveGuildLevel` → `/denied` |
| Drift entre schema Zod de config e jsonb salvo                    | campo `version` + migração de config na leitura                                                                                            | feito: `packages/shared/src/config` |
| Disco cheio (logs, message_cache)                                 | retenções (§8), rotação Docker; o disco do banco agora é do Supabase (alerta de cota)                                                       | feito: `RetentionJob` com alerta na falha; `json-file` com 5×10 MB; `docker system prune` semanal no bootstrap |
| **Backup do Supabase não é exportável no free tier**              | `pg_dump` próprio diário no serviço `backup` do Compose, 7 diários + 4 semanais no volume `backups`; `infra/scripts/restore.sh`             | feito: só os schemas `public` e `drizzle` (o resto é do Supabase e quebra o restore num Postgres comum); imagem na mesma major do Supabase (17); dump sem o rodapé do `pg_dump` é descartado e alerta; o `/health` ignora arquivo < 1 KB. Cópia externa (Object Storage + rclone) segue **opcional e não implementada** |
| **Perder o rastro do que está rodando na VM**                     | `GIT_SHA` embutido na imagem pela CI, exibido no `/health`, no card Saúde e no alerta de boot                                              | feito: `infra/docker/bot.Dockerfile` |
| **Rate limit do painel na Vercel**                                | 60/min por IP nas rotas de auth e nas server actions de escrita                                                                             | parcial: contagem **por instância**, porque o painel é stateless e a stack não tem store compartilhado (§12); serve para cortar script, não como cota |
| **Presence Intent** (v1.8)                                        | terceira intent privilegiada, com o mesmo teto de 100 servidores. Pedi-la sem habilitá-la no Developer Portal derruba o login (`Used disallowed intents`), então habilitar vem antes do deploy. O handler descarta cedo (guild fora do registro, módulo desligado) e o cache de presença fica desligado | planejado: habilitar no Portal é **manual**, do dono do bot, e bloqueia a etapa do aviso automático |
| **Queda de conexão punida como saída** (v1.8)                     | o Discord manda o mesmo evento para sair e para cair; o cargo e a sala esperam `graceMinutes` (2) e voltar dentro da janela cancela         | planejado |
| **Cargo ou sala órfã depois de restart** (v1.8)                   | reconciliação no boot e ao ligar o módulo: lista quem tem o cargo e não está em voz e as salas vazias da categoria, e conta a janela do zero; a busca também expira sozinha em `searchTtlMinutes` | parcial por desenho: o relógio é memória, então um restart pode estender cargo e sala por uma janela |
| **Teto de 500 canais por servidor** (v1.5)                        | a sala é efêmera e há no máximo 24 (os nomes do alfabeto grego); no teto ou sem permissão o bot não cria nem move, e a pessoa fica no canal de criar com o motivo no log | planejado |
| **Painel fixo editado em rajada** (v1.8)                          | edição coalescida (uma a cada poucos segundos), falha não derruba e a mudança seguinte tenta de novo; mensagem apagada é republicada sem duplicar | planejado |
| **Aviso automático virar spam** (v1.8)                            | só a DM depois de o jogo aparecer na presença, no máximo uma a cada 6 h, nunca para quem tem `Sem Aviso de Squad` ou já busca, e o NÃO AVISAR MAIS vira o cargo de opt-out; DM fechada é ignorada | planejado: o relógio das 6 h é memória, e um restart custa no máximo uma DM a mais |
| **Jogatina marcada em série** (v1.8)                              | teto de 10 eventos futuros do bot por servidor (`LFG_MAX_EVENTS`); o modal recusa e diz o motivo                                             | planejado |
| **Horário do agendar mal entendido** (v1.6)                       | `parseWhen` puro no fuso da guild, erro que traz exemplos e horário que já passou sugere o do dia seguinte                                   | feito: `shared/squads/when.ts`, com testes de tabela |

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
| **Bot na Oracle E2.1.Micro (x86)**  | Always Free e sempre disponível; o bot é ≤ 300 MB RSS e precisa de processo longo com gateway aberto, exatamente o que serverless não faz |
| **Imagens `linux/amd64`**           | consequência do E2.1.Micro; some o build QEMU/ARM na CI, que era o passo mais lento do deploy                                          |
| **Painel na Vercel**                | Next.js roda nativamente, deploy por git, previews por PR, HTTPS e CDN sem configurar nada; plano Hobby é gratuito para uso não-comercial |
| **Postgres no Supabase**            | free tier sempre ligado (Neon suspende por inatividade e o pool do bot brigaria com isso); backups gerenciados; pooler pgBouncer necessário para as funções serverless da Vercel |
| **API do bot exposta com TLS**      | com o painel fora da Oracle, `bot ↔ web` deixa de ser rede privada; Caddy publica só essa API num subdomínio, protegida por Bearer token, rate limit e body cap (§7.3) |
| Docker Compose + Caddy              | um arquivo descreve o que roda na VM (bot + caddy); Caddy faz HTTPS automático (Let's Encrypt) e headers; sem nginx + certbot         |
| GitHub Actions → SSH deploy         | build amd64 na CI (imagem no GHCR), servidor só faz `docker compose pull && up -d`; sem build na instância free tier                   |
| Config no banco, não em arquivo     | painel precisa alterar em tempo real sem redeploy                                                                                      |
| Stats em buckets agregados          | free tier: nunca guardar evento bruto por mensagem; consultas do painel ficam baratas                                                  |
| **Guild como código em YAML**       | estrutura de servidor é dado declarativo e revisável em PR; YAML aceita comentário, que JSON não aceita, e o arquivo é para humano escrever à mão |
| **Spec sem ID, resolvido em runtime** | um `guild.yaml` com ID identifica a guild de quem o escreveu (o repositório é público) e não pode ser reaproveitado em outro servidor |
| **CLI como cliente da API do bot**  | escrever direto no Discord duplicaria as checagens de permissão e hierarquia que já existem na API; um segundo caminho de escrita é um segundo lugar para errar |
| **Quem o bot atende é tabela, não variável** (v1.3) | aprovar um servidor não pode exigir deploy nem SSH; e a fila continua funcionando com o bot fora do ar, que é justamente o dia em que se precisa dela. O `GUILD_IDS` sobrou como semente do registro no boot |
| **Demo com prazo fixo de 1 h, sem renovação** (v1.3) | prazo por servidor viraria um plano gratuito negociável; renovar viraria acesso permanente por reconvite. O prazo curto também é o que segura o teto de 100 servidores das intents privilegiadas |
| **`state` do convite assinado** (v1.3) | é o `state` que carrega o fluxo (`pending` ou `demo`), então sem HMAC quem cola o link escolhe o próprio status. Assinado no clique, com validade de 15 min |
| **Convite tem escrita própria, não upsert** (v1.4) | o `guildCreate` cria a linha antes de o callback do OAuth rodar; um upsert que nunca sobrescreve fazia o link da demo entregar um servidor `pending`. Quem assume a linha é o fluxo do convite, só quando ela é `pending`, `expired` ou demo gasta |
| **Aviso de 10 min da demo só por DM** (v1.4) | quem decide pedir a aprovação é quem convidou; contagem regressiva no canal é barulho para quem não decide nada. A despedida continua pública, porque a saída é um fato do servidor |
| **Fila expira em 1 semana, como `expired`** (v1.4) | fila sem prazo é depósito, e um bot mudo parado num servidor não distingue "não aprovaram" de "instalei errado". `expired` em vez de `blocked` porque é ausência de decisão, não decisão: convidar de novo funciona |
| **Avisos de convite pedidos pelo painel** (v1.4) | o bot não sabe por qual link a pessoa veio quando o `guildCreate` chega. Quem sabe é o painel; o bot só escolhe o texto, de uma lista fechada, e o destinatário sai do `invited_by` da linha |
