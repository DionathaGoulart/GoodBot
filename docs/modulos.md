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
Reiniciar o bot não perde o agendamento — ele está no banco.

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
> com backtracking catastrófico — regex de usuário não derruba o bot.

---

## Logs

Roteia eventos para canais separados por assunto: mensagens, membros, servidor
e voz. Cada assunto tem canal próprio na config.

O `LogQueue` existe porque um evento em massa (raid, purge grande) geraria
centenas de escritas simultâneas e estouraria o rate limit do Discord. A fila
absorve o pico e escoa no ritmo permitido.

Edição e exclusão de mensagem precisam do conteúdo anterior, que o Discord não
manda no evento — daí a tabela `message_cache`, com prazo de retenção próprio.

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
`/unlock` devolver exatamente o que havia — e não um palpite.

---

## Estatísticas

Mensagens, entradas e saídas, tempo em voz e casos, agregados por hora e por
dia em `stat_buckets`.

O `StatsService` acumula em memória e faz flush periódico: contar uma mensagem
por vez seria um `INSERT` por mensagem. O job `stats-rollup` compacta hora em
dia.

Falha de flush vira alerta operacional — número perdido não volta.

---

## Redes sociais

Avisa num canal quando o canal do YouTube publica vídeo, short ou live.

**Não pede credencial nenhuma.** Tudo sai de páginas públicas do próprio
YouTube: feed RSS, `watch?v=` e `/channel/<id>/live`. Sem chave, sem cota, sem
conta no Google Cloud.

Funciona por **polling**, nunca por webhook de entrada — a API do bot está
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

## Squads

Squad fixo: o mesmo grupo, que marca jogatina quando quer. Quem procura monta um
perfil com a agenda da semana, o bot cruza os perfis compatíveis, propõe o grupo
e dá a cada squad um canal privado com um guia fixo. A agenda serve só para o
match: a hora de jogar é o squad que marca, com `/bora` ou o botão `BORA`, e o
bot chama o grupo e reserva um voice na hora. O módulo serve a qualquer jogo: jogos e perguntas do perfil são cadastrados no
painel, em **Squads > `JOGOS`**.

**Entrar.** A mensagem fixa do canal de busca tem um botão por jogo ligado. O
botão abre o perfil em dois passos: um modal com as perguntas do jogo (no máximo
5, o teto de um modal do Discord) e depois a grade da semana, 7 dias por 4
faixas (manhã, tarde, noite e madrugada), numa mensagem efêmera com um select por
faixa. Salvar a grade é o "quero procurar": o perfil entra na busca e o match
roda na hora.

| Comando                  | O que faz                                                                       |
| ------------------------ | ------------------------------------------------------------------------------- |
| `/bora [quando] [squad]` | marca uma jogatina (`agora`, `hoje 21h`, `sex 22h`); sem "quando", abre o modal |
| `/squad perfil`          | abre o mesmo perfil do botão                                                    |
| `/squad status`          | procurando ou pausado; procurar exige grade marcada                             |
| `/squad procurar`        | squads com vaga nos seus horários, com botão para pedir entrada                 |
| `/squad convidar`        | chama alguém para o seu squad; quem aceita entra sem votação                    |
| `/squad sair`            | sai do squad; o último a sair arquiva                                           |
| `/squad renomear`        | só quem é do squad                                                              |
| `/squad painel`          | admin: publica ou reedita a mensagem fixa                                       |

Os comandos são atalho: tudo o que eles fazem está também num botão de uma
mensagem do bot (mensagem fixa, guia do squad, mensagem da jogatina, chamada
pública, convite).

**Squad e party.** Cada jogo tem dois tamanhos: o do squad, que é o grupo
inteiro (até 20), e o da party, quem joga junto numa partida (até 10, nunca mais
que o squad). No Helldivers 2 a party é 4, e o squad pode ter 8 ou 12 que se
dividem conforme quem aparece. Os dois ficam no cadastro do jogo, em
**Squads > `JOGOS`** ("Tamanho do squad" e "Jogam por vez"). Subir o tamanho do
squad reabre na hora a vaga dos squads que estavam cheios.

**Match.** Só entre perfis que estão procurando, no mesmo jogo. Cada célula da
grade em comum vale 1 ponto e cada resposta igual num campo "pesa no match" vale
3; resposta diferente num campo "precisa bater" separa a dupla, e texto livre
nunca conta. O grupo inteiro precisa dividir pelo menos uma célula, para ter um
horário em que todos joguem juntos, e por isso a turma proposta tem no máximo uma
party: o resto do squad chega por convite. A mesma dupla não é proposta de novo por 14 dias
(`reproposeCooldownDays`). Antes de propor grupo novo, o matcher olha as vagas
dos squads abertos: quem divide uma célula com gente suficiente do squad para
fechar uma party recebe um convite para aquele squad (abaixo).

**Proposta sem líder.** Cada grupo recebe uma thread privada no canal de busca,
com `ACEITO` e `PASSO`, e mostra em que horário a turma bate (só informação: o
squad não tem horário fixo). O primeiro aceite cria o squad, cada aceite seguinte
ocupa uma vaga e quem passou fica de fora. Sem nenhum aceite a proposta fecha em
72 h (`proposalTtlHours`).

**Entrar num squad que já existe.** São duas fases, e ninguém entra sem os dois
lados quererem. Primeiro o **convite**: uma thread privada no canal de busca, só
com o candidato, mostrando o squad, os membros, o histórico e o prazo, com
`ENTRAR` e `PASSO`. O squad não fica sabendo de nada até ele aceitar. No `ENTRAR` começa a
**votação** no canal do squad, que chama os membros, com `A FAVOR` e `CONTRA`, as
respostas de seleção do candidato e em que horário ele joga com o grupo. Quem
pede pelo `/squad procurar` ou pelo `ENTRAR` de uma chamada pública pula o
convite: o clique já é o aceite.

| Votos                                  | Resultado                                 |
| -------------------------------------- | ----------------------------------------- |
| metade do squad ou mais a favor        | entra na hora (empate entra)              |
| mais da metade contra                  | recusado, e o candidato é avisado na thread |
| prazo de 72 h vencido                  | entra com um voto a favor e sem maioria contra; senão, fica de fora |

Com dois membros basta um a favor; com três, dois; com sete, quatro. Dá para
trocar o voto, e quem sai do squad no meio deixa de contar. Convite sem resposta
vence em 72 h, e a votação tem mais 72 h a partir do `ENTRAR`. Quem passou, foi
recusado ou deixou vencer não é chamado de novo para o mesmo squad por 14 dias.

Membro convida direto com `CONVIDAR` no guia (escolhe a pessoa num select) ou
`/squad convidar @pessoa`. É o mesmo convite, mas quem aceita entra sem
votação, porque foi o squad que chamou, e não precisa ter perfil nem horário
compatível.

**A casa do squad.** Um canal de texto privado na categoria escolhida. A primeira
mensagem dele é o **guia**, pinado: membros e vagas, sala preferida, próximas
jogatinas, o histórico com quem mais aparece e os botões em duas linhas: `BORA`,
`CHAMAR GENTE` e `CONVIDAR` em cima; `RENOMEAR`, `PROCURAR OUTRO SQUAD` (quando o
servidor deixa estar em mais de um squad) e `SAIR DO SQUAD` embaixo. O bot reedita o
guia a cada mudança e publica de novo se alguém o apagar. Voice não se cria por
squad: os voices do pool (os Hellpods, no Goodivers) são emprestados por
jogatina, porque o Discord só deixa renomear canal duas vezes a cada dez minutos
e o servidor tem teto de 500 canais.

**Jogatina.** Quem quer jogar aperta `BORA` no guia (um campo só, "quando") ou
usa `/bora hoje 21h`. O bot entende `agora`, `hoje 21h`, `hoje 21:30`,
`amanhã 20h`, `sex 22h`, `dom 15h` e `16/09 21h`, no fuso do servidor, e o
autocomplete mostra o que ele entendeu antes de enviar. Quem marcou já vai. A
mensagem da jogatina chama o squad e tem `VOU`, `NÃO VOU` e `CANCELAR`; ela dura
3 h (`sessionHours`) e cada squad tem até 5 marcadas (`maxUpcomingSessions`).
A contagem diz se a party fechou ("fechada, 4 de 4") ou, com mais gente que a
party, quantas dá ("dá 2 parties: 7 vão e cada partida leva até 4"); o bot
reserva um voice só e deixa o squad se dividir.
Meia hora antes (`reminderMinutesBefore`) um voice livre do pool fica reservado
(`@everyone` sem `Connect`, os membros com) e sai um lembrete curto. Jogatina
marcada para daqui a pouco já sai com sala; marcada para `agora`, já começa. Na
hora, quem está em outro voice é movido e quem não está em nenhum é chamado. No
fim da jogatina, ou quando o voice esvazia depois do início, as permissões
voltam exatamente ao que eram. Com o pool todo ocupado, o bot cria um voice só
para a jogatina (`Jogatina · <squad>`, na categoria dos squads, trancado do
mesmo jeito) e o apaga quando ele esvazia depois do início, ou no fim, mas
nunca com gente dentro. A opção fica na aba de configuração ("Voice temporário
com o rodízio cheio"); desligada, ou sem permissão do bot para criar canal, a
jogatina acontece sem sala e o lembrete avisa. Se o bot cair no meio da
criação da sala, o job acha o canal que sobrou e o adota ou apaga sozinho.

`CANCELAR` vale antes do início, para quem marcou ou para qualquer membro
enquanto ninguém mais confirmou. Depois do início, a mensagem ganha `REPETIR`,
que marca a mesma hora na semana seguinte. Não há jogatina automática: a rotina
é o `REPETIR`.

**Chamar gente de fora.** Faltou gente na party? `CHAMAR GENTE`, na mensagem da
jogatina ou no guia (que pega a próxima jogatina com lugar), posta a jogatina no
canal de busca com o histórico do squad e um botão `ENTRAR`. Quem aperta vira
pedido de entrada e o squad vota, como no `/squad procurar`, mas sem precisar de
perfil: a pessoa respondeu a uma jogatina com dia e hora. Quem entra já fica
como `VOU` nela. Uma chamada por jogatina, só antes do início, com vaga no squad
e lugar na party (o botão some quando não dá). A chamada é apagada quando a
jogatina começa, é cancelada ou o squad é arquivado.

**Histórico.** O bot anota quem do squad entra no voice reservado de cada
jogatina e resume o que rolou: "6 jogatinas no último mês, geralmente sexta e
sábado à noite. Última há 3 dias." ou "Ainda não jogaram.". A frase aparece no
convite, no `/squad procurar`, no guia (com quem mais aparece), na chamada
pública e no painel. Só conta jogatina em que alguém do squad apareceu no voice
(ou, sem sala, que começou com dois `VOU`); marcar e ninguém ir não entra.

> O retrato das permissões do voice mora em `squad_sessions`, não em
> `channel_locks`: um `/lock` num voice reservado trocaria o que a liberação
> restaura.

**Ciclo de vida.** Marcar jogatina, `VOU`, presença no voice reservado e
`AINDA JOGAMOS` contam como sinal de vida. Sem nenhum por 4 semanas (`inactiveWeeks`), o squad recebe um
aviso; sem resposta em 7 dias, é arquivado: canal só leitura, voice liberado,
chamadas públicas apagadas, convites, votações e propostas encerrados e perfis
pausados.

Quem move tudo isso é o job `squads`, a cada 5 minutos, em cada servidor com o
módulo ligado: lembra, reserva, começa e libera as jogatinas, mas nunca marca
uma. O passo diário (inatividade, guias em dia e um match novo) roda uma vez por
dia, depois das 12 h no fuso do servidor, para ninguém ser chamado de madrugada.

**Pelo painel.** Em **Squads > `JOGADORES`** o admin vê, por jogo, todos os
perfis com nome, status, respostas e a ocupação da grade, além das propostas
abertas e do botão de match automático (quem é `mod` vê só as propostas).
Marcando duas ou mais pessoas, o painel mostra a nota de cada dupla e os avisos,
e `PROPOR AO GRUPO` abre a revisão feita pelo bot. O match manual só propõe: sai
a mesma thread privada com `ACEITO` e `PASSO`, com uma nota dizendo que a turma
foi escolhida no painel, e ninguém entra em squad sem aceitar. Pessoa sem perfil
no jogo, fora do servidor, já num squad ou numa proposta aberta desse jogo, ou um
grupo sem nenhum horário em comum **bloqueiam** a proposta. Perfil pausado, turma
maior que o squad, pessoa no teto de squads, dupla proposta há menos de 14 dias,
resposta diferente num campo "precisa bater" e convite ou votação de entrada aberto só
**avisam**, e o admin marca que leu antes de confirmar. No perfil de cada pessoa
dá para pausar ou retomar a busca, editar as respostas, apagar o perfil (não
enquanto ela estiver num squad, numa proposta aberta ou com convite ou votação aberto
nesse jogo) e tirar de um squad; tirar do squad funciona até com o módulo
desligado. Cada ação pede um motivo, e a pessoa recebe uma DM dizendo que a
staff do servidor mudou algo, com o motivo e o comando para conferir ou voltar
atrás (`/squad status`, `/squad perfil` ou `/squad procurar`). O nome de quem
clicou não vai na DM, fica na auditoria. Se a DM não chegar (DM fechada ou pessoa
fora do servidor), a ação vale do mesmo jeito e o aviso do painel diz que a
pessoa não foi avisada. Quem é tirado de um squad some do canal, e o canal fica
sabendo que foi a staff, sem o motivo.

> O bot precisa de `Connect`, `Speak`, `CreatePrivateThreads` e `PinMessages`.
> Sem elas o match não abre a thread da proposta, a reserva do voice é pulada e o
> guia sai sem pin, com aviso no log em vez de erro. O link de convite pede as
> quatro; num servidor que convidou o bot antes disso, dê ao cargo dele à mão as
> que faltarem.

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
