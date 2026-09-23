# Módulos

Cada módulo liga e desliga por servidor, tem uma página no painel e um schema
Zod próprio em `packages/shared/src/config/`. A configuração é guardada como
`jsonb` em `module_configs` e lida pelo `ConfigService`, que mantém cache.

Mudou config pelo painel? O painel chama `POST /guilds/:id/config/invalidate` e
o bot derruba o cache na hora. Não há espera.

---

## Moderação

Ban, kick, timeout, warn e notas, cada ação virando um **caso numerado**.

| Comando                  | O que faz                                        |
| ------------------------ | ------------------------------------------------ |
| `/ban`                   | banimento, com opção de tempo (tempban)          |
| `/softban`               | ban + unban para limpar mensagens                |
| `/kick`                  | expulsa                                          |
| `/timeout`, `/untimeout` | silencia por tempo                               |
| `/warn`                  | advertência, conta para o escalonamento          |
| `/note`                  | nota interna, invisível para o membro            |
| `/case`, `/reason`       | consulta e edita um caso                         |
| `/history`               | histórico de um membro                           |
| `/punish`                | aplica a punição do nível de escalonamento atual |

O tempban entra em `scheduled_actions` e é o `Scheduler` que desfaz na hora.
Reiniciar o bot não perde o agendamento: ele está no banco.

**Escalonamento**: N advertências em X tempo dispara uma ação automática. Os
degraus ficam na config do módulo.

---

## Automod

Avalia cada mensagem contra as regras ligadas. Motor em
`apps/bot/src/automod/`, uma regra por arquivo em `rules/`.

| Regra      | Pega                                  |
| ---------- | ------------------------------------- |
| `spam`     | repetição e rajada de mensagens       |
| `links`    | URLs, com lista de permitidos         |
| `caps`     | proporção de maiúsculas               |
| `words`    | lista de palavras, com regex opcional |
| `mentions` | menções em excesso numa mensagem      |

Cada regra tem ação própria (apagar, avisar, advertir, timeout) e cargos
isentos. Todo acionamento grava em `automod_hits`, que alimenta as estatísticas
e é apagado pela retenção.

**Modo anti-raid** (`/raid`): endurece entrada e mensagens durante uma onda.
Também é ligável pelo painel e pela API.

> A regra `words` aceita regex. O projeto usa `safe-regex2` para recusar padrão
> com backtracking catastrófico: regex de usuário não derruba o bot.

---

## Logs

Roteia eventos para canais separados por assunto: mensagens, membros, servidor
e voz. Cada assunto tem canal próprio na config.

O `LogQueue` existe porque um evento em massa (raid, purge grande) geraria
centenas de escritas simultâneas e estouraria o rate limit do Discord. A fila
absorve o pico e escoa no ritmo permitido.

Edição e exclusão de mensagem precisam do conteúdo anterior, que o Discord não
manda no evento: daí a tabela `message_cache`, com prazo de retenção próprio.

O cache tem duas camadas: as últimas `messageCache.perChannel` mensagens de
cada canal ficam na memória do bot (o valor é do servidor dono do canal e não
afeta os outros), e canal sem mensagem nova há 1 h sai dela; o banco guarda 7
dias. É o que mais pesa no banco e na RAM, por isso o dono do bot pode
desligá-lo por servidor no `/admin` (ver `docs/runbook.md`).

---

## Boas-vindas

Mensagem de entrada, de saída e DM, por template. Os placeholders
(`{user}`, `{server}`, `{count}`) são resolvidos em
`apps/bot/src/lib/template.ts`.

---

## Autorole

Cargo automático na entrada, e **verificação por botão**: o membro entra sem
acesso, clica no botão de um painel e recebe o cargo. Segura bot de raid que
entra e sai sem interagir.

---

## Reaction roles

Painéis onde o membro escolhe cargo por **botão**, **menu** ou **reação**.
Publicados pelo painel ou por `/reactionrole`. Os painéis ficam em
`reaction_role_panels`, os itens em `reaction_role_items`.

Despublicar remove a mensagem sem perder a configuração.

---

## Tickets

Tipos de ticket, painel de abertura, canal privado por ticket, transcript no
fechamento.

`/ticket` abre; o fechamento gera o transcript e arquiva. O transcript é
montado em `apps/bot/src/services/transcript.ts`.

---

## Tags

Respostas salvas, com autocomplete no `/tag`. Útil para FAQ recorrente. Criação
e edição pelo painel ou pelo comando.

---

## Utilidades

| Comando            | O que faz                               |
| ------------------ | --------------------------------------- |
| `/clear`, `/purge` | apaga mensagens, com filtros            |
| `/lock`, `/unlock` | fecha e reabre canal                    |
| `/slowmode`        | modo lento                              |
| `/remind`          | lembrete (via `scheduled_actions`)      |
| `/poll`            | enquete                                 |
| `/say`             | publica uma mensagem como o bot         |
| `/info`            | informação de membro, canal ou servidor |
| `/stats`           | números do servidor                     |

`/lock` grava em `channel_locks` o estado anterior das permissões, para o
`/unlock` devolver exatamente o que havia, e não um palpite.

---

## Estatísticas

Mensagens, entradas e saídas, tempo em voz e casos, agregados por hora e por
dia em `stat_buckets`.

O `StatsService` acumula em memória e faz flush periódico: contar uma mensagem
por vez seria um `INSERT` por mensagem. O job `stats-rollup` compacta hora em
dia.

Falha de flush vira alerta operacional: número perdido não volta.

---

## Redes sociais

Avisa num canal quando o canal do YouTube publica vídeo, short ou live.

**Não pede credencial nenhuma.** Tudo sai de páginas públicas do próprio
YouTube: feed RSS, `watch?v=` e `/channel/<id>/live`. Sem chave, sem cota, sem
conta no Google Cloud.

Funciona por **polling**, nunca por webhook de entrada: a API do bot está
exposta na internet e o PRD §7.3 proíbe rota sem autenticação além do
`/health`. O intervalo fica na config do módulo.

Cadastrar: no painel, **Redes sociais > `ADICIONAR CANAL`**, colando a URL
(`https://www.youtube.com/@LofiGirl`), o `@handle` ou o ID `UC…`. O bot resolve
os três e mostra o cartão com avatar e nome antes de salvar. Pelo Discord é
`/social add`; `/social list` mostra o estado e `/social test` manda um anúncio
de exemplo.

Cada conta tem dois cargos opcionais para mencionar: um nos anúncios de vídeo e
short, outro nos de live (no `/social add`, as opções `cargo` e `cargo-live`).
Um não substitui o outro: deixar o de lives vazio significa live sem ping.

> A primeira passada de uma conta nova **não anuncia nada**: ela marca o que já
> estava no feed e passa a avisar do próximo post em diante. Sem isso, cadastrar
> um canal despejaria os últimos 15 vídeos de uma vez.

> **Se o feed do YouTube cair, a live continua sendo avisada.** Numa conta que
> também quer live, o feed passa a ser de melhor esforço: a sonda de live roda
> em toda passada e o feed é tentado de novo depois de 5 a 30 min. Os vídeos que
> saíram nesse meio-tempo são anunciados quando ele voltar. Numa conta só de
> vídeo e short, o feed fora do ar conta como falha, e na décima seguida a conta
> entra em pausa (de 15 min a, no máximo, 1 h).

---

## Buscar squad

Quem quer jogar agora acha gente agora. O módulo (`squads`) não guarda perfil,
agenda nem grupo fixo: ele mostra **quem está buscando** e **onde já tem sala
aberta**, e deixa o Discord ser o estado. O cargo é do Discord, a sala é do
Discord e a agenda é o evento agendado do Discord. Não há match: quem entra
numa sala entra porque quis. Serve ao jogo que estiver em "Jogos que disparam o
aviso" (padrão `HELLDIVERS™ 2`), mas nada nele é escrito para um jogo só.

**Dois cargos**, criados pela staff (à mão ou no `guild.yaml`), nenhum com
permissão, os dois abaixo do cargo do bot:

- `Buscando Squad`, com `hoist`: a lista de membros mostra à parte quem quer
  jogar agora.
- `Sem Aviso de Squad`: quem tem nunca recebe o aviso automático e continua
  livre para ligar a busca à mão.

**Ligar a busca.** Quando alguém abre o jogo (rich presence do Discord), o bot
manda **uma DM** com `BUSCAR SQUAD`, `AGORA NÃO` e `NÃO AVISAR MAIS` (este dá o
`Sem Aviso de Squad`). Só o clique liga o cargo: ver o jogo aberto nunca liga
sozinho. O aviso não sai para quem já busca, tem o opt-out, está numa sala ou
recebeu um nas últimas 6 horas. Quem joga em console, sem rich presence, usa o
botão `BUSCAR SQUAD` do painel ou `/squad buscar`.

**Desligar.** O mesmo botão ou comando; sair de todos os canais de voz; ou não
entrar em nenhum em "Expiração da busca" (padrão 120 min). Estar numa sala não
desliga: sala com vaga ainda quer gente.

**Janela de tolerância.** O Discord manda o mesmo evento para quem sai de
propósito e para quem cai (internet, PC, jogo travado). Por isso sair da voz só
vale depois da "Janela de tolerância" (padrão 2 min, de 0 a 10), e voltar
dentro dela cancela. Vale para o cargo e para a sala. O relógio é memória: num
restart o bot reconcilia e conta a janela do zero para todo mundo, então um
cargo ou uma sala pode durar até uma janela a mais.

**Salas.** O canal de voz fixo `➕ Criar Squad` é *join-to-create*: quem entra
nele ganha uma sala nova na categoria das salas e é movido para ela. O nome é
`Squad <nome>`, com o primeiro livre do alfabeto grego (Alfa, Beta, Gama...
Ômega, 24 no máximo), o teto de gente é o "Tamanho da sala" (padrão 4, de 2 a
10) e ela herda as permissões da categoria. A sala some quando esvazia e a
janela passa. Sem permissão, com 500 canais no servidor ou com os 24 nomes em
uso, o bot não cria nem move, e o motivo sai no log.

> **A categoria das salas é do módulo.** Sem tabela, quem diz que um canal é
> sala é o nome e a categoria: um canal de voz feito à mão ali, com nome
> `Squad <nome grego>`, é apagado quando esvaziar. O `➕ Criar Squad` nunca é
> apagado.

**Painel.** Uma mensagem fixada no canal do painel lista as salas com gente
(`🟢 Squad Alfa · 1/4 · clique pra entrar`, `🔴 ... lotada`), as próximas 3
jogatinas e os botões `BUSCAR SQUAD`, `SEM AVISO` e `MARCAR JOGATINA`. O bot a
reedita sozinho, no máximo uma vez a cada 5 s por servidor. Publicar ou
atualizar: `/squad painel` (admin) ou o botão `PUBLICAR`/`ATUALIZAR` em
**Buscar squad** no painel web (salve a config antes: o bot usa a salva). Se a
mensagem for apagada, ela volta na mudança seguinte.

**Jogatina agendada.** Sem ninguém buscando agora, `MARCAR JOGATINA` (ou
`/squad agendar`) abre um campo "quando" (`hoje 21h`, `amanhã 20h`, `sex 22h`,
`16/09 21h`, no fuso do servidor; `agora` não vale, isso é uma sala) e o bot cria
um **evento nativo do Discord** de voz no `➕ Criar Squad`, de 3 horas. RSVP e
lembrete são do Discord. O bot só **inicia o evento na hora**, porque evento de
voz não começa sozinho e é o início que avisa quem marcou "Tenho interesse".
Teto de 10 jogatinas futuras do bot por servidor. Quem marcou não edita nem
cancela pelo Discord (o criador é o bot): isso é de quem tem `ManageEvents`, e
a descrição do evento diz quem marcou.

| Comando          | Faz                                                          |
| ---------------- | ------------------------------------------------------------ |
| `/squad buscar`  | liga ou desliga o `Buscando Squad`                           |
| `/squad aviso`   | liga ou desliga o `Sem Aviso de Squad`                       |
| `/squad agendar` | abre o modal da jogatina                                     |
| `/squad painel`  | admin: publica ou reedita a mensagem fixa                    |

Todo comando é atalho de um botão que já está no painel ou na DM.

**Pelo painel web**, em **Buscar squad**: liga o módulo, escolhe os dois
cargos, o canal do painel, a categoria das salas e o canal de criar, e ajusta
tamanho da sala, janela de tolerância, expiração da busca e os jogos que
disparam o aviso.

> O bot precisa de `ManageRoles` (com o cargo dele acima dos dois),
> `ManageChannels`, `Connect` e `MoveMembers` na categoria, `SendMessages`,
> `EmbedLinks` e `PinMessages` no canal do painel e `ManageEvents`. E da intent
> privilegiada **Presence** ligada no Developer Portal, sem a qual o bot nem
> loga. Onde há clique, falta de permissão vira erro efêmero que diz o que
> falta; onde não há (a sala nascendo, o cargo caindo), o motivo vai para o log.

> Botão de mensagem do módulo antigo (o squad fixo das versões v1.5 a v1.7 do PRD) responde que
> aquele fluxo acabou. Canais que os squads antigos deixaram viram canais
> comuns: limpar é da staff.

---

## Adicionar um módulo

1. Schema Zod em `packages/shared/src/config/<modulo>.ts`, exportado no barrel.
2. Service em `apps/bot/src/services/`, recebendo o que precisa pelo
   `BotContext`.
3. Comandos em `apps/bot/src/commands/<grupo>/` e/ou eventos em
   `apps/bot/src/events/<assunto>/`.
4. Página em `apps/web/app/g/[guildId]/config/<modulo>/` e formulário em
   `apps/web/components/config/`.
5. Registrar em `apps/web/lib/config-pages.ts`.
6. Se precisa de tabela: schema em `packages/db`, `db:generate`, revisar o SQL,
   `db:migrate`.
