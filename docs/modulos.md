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

---

## Squads

Squad fixo: o mesmo grupo, no mesmo horário, toda semana. Quem procura monta um
perfil com a agenda da semana, o bot cruza os perfis compatíveis, propõe o grupo
e dá a cada squad um canal privado e um voice reservado na hora da sessão. O
módulo serve a qualquer jogo: jogos e perguntas do perfil são cadastrados no
painel, em **Squads > `JOGOS`**.

**Entrar.** A mensagem fixa do canal de busca tem um botão por jogo ligado. O
botão abre o perfil em dois passos: um modal com as perguntas do jogo (no máximo
5, o teto de um modal do Discord) e depois a grade da semana, 7 dias por 4
faixas (manhã, tarde, noite e madrugada), numa mensagem efêmera com um select por
faixa. Salvar a grade é o "quero procurar": o perfil entra na busca e o match
roda na hora.

| Comando           | O que faz                                                       |
| ----------------- | --------------------------------------------------------------- |
| `/squad perfil`   | abre o mesmo perfil do botão                                    |
| `/squad status`   | procurando ou pausado; procurar exige grade marcada             |
| `/squad procurar` | squads com vaga nos seus horários, com botão para pedir entrada |
| `/squad sair`     | sai do squad; o último a sair arquiva                           |
| `/squad renomear` | só quem é do squad                                              |
| `/squad painel`   | admin: publica ou reedita a mensagem fixa                       |

**Match.** Só entre perfis que estão procurando, no mesmo jogo. Cada célula da
grade em comum vale 1 ponto e cada resposta igual num campo "pesa no match" vale
3; resposta diferente num campo "precisa bater" separa a dupla, e texto livre
nunca conta. O grupo inteiro precisa dividir pelo menos uma célula, que vira a
janela semanal do squad. A mesma dupla não é proposta de novo por 14 dias
(`reproposeCooldownDays`). Antes de propor grupo novo, o matcher olha as vagas
dos squads abertos: o candidato vira um pedido de entrada no canal do squad, e
só fica sabendo quando for aceito.

**Proposta sem líder.** Cada grupo recebe uma thread privada no canal de busca,
com `ACEITO` e `PASSO`. O primeiro aceite cria o squad, cada aceite seguinte
ocupa uma vaga e quem passou fica de fora. Sem nenhum aceite a proposta fecha em
72 h (`proposalTtlHours`), e o pedido de entrada vence no mesmo prazo. No pedido
basta um membro aceitar; ele só é recusado quando todos recusam.

**A casa do squad.** Um canal de texto privado na categoria escolhida. Voice não
se cria por squad: os voices do pool (os Hellpods, no Goodivers) são emprestados
na hora, porque o Discord só deixa renomear canal duas vezes a cada dez minutos
e o servidor tem teto de 500 canais. Meia hora antes da sessão
(`reminderMinutesBefore`) sai o lembrete com `VOU` e `NÃO VOU`, e um voice livre
do pool fica reservado: `@everyone` sem `Connect`, os membros com. Na hora, quem
está em outro voice é movido e quem não está em nenhum é chamado. No fim da
faixa, ou quando o voice esvazia depois do início, as permissões voltam
exatamente ao que eram. Com o pool todo ocupado a sessão acontece sem sala, e o
lembrete avisa.

> O retrato das permissões do voice mora em `squad_sessions`, não em
> `channel_locks`: um `/lock` num voice reservado trocaria o que a liberação
> restaura.

**Ciclo de vida.** `VOU`, presença no voice reservado e `AINDA JOGAMOS` contam
como sinal de vida. Sem nenhum por 4 semanas (`inactiveWeeks`), o squad recebe um
aviso; sem resposta em 7 dias, é arquivado: canal só leitura, voice liberado,
pedidos e propostas encerrados e perfis pausados.

Quem move tudo isso é o job `squads`, a cada 5 minutos, em cada servidor com o
módulo ligado. O passo diário (inatividade e um match novo) roda uma vez por
dia, depois das 12 h no fuso do servidor, para ninguém ser chamado de madrugada.

> O bot precisa de `Connect`, `Speak` e `CreatePrivateThreads`. Sem elas o match
> não abre a thread da proposta e a reserva do voice é pulada, com aviso no log
> em vez de erro. O link de convite pede as três; num servidor que convidou o
> bot antes disso, dê as três ao cargo dele à mão.

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
