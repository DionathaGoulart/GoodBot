# Auditoria do CoBot — 28/10/2026

## Correções locais após a auditoria

Os 17 achados abaixo receberam correções de código e testes de regressão neste
checkout, após o pedido do usuário. O restante do documento preserva as evidências
do estado anterior (`518361f`); referências de linha e versões naquela análise
são históricas. Até a conclusão da validação local, nenhum commit, deploy ou
alteração de produção havia sido realizado.

| Achado                        | Correção implementada                                                                                                      |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 01 — falsos logs de cargos    | Estado parcial não gera diffs; deltas reais vêm do evento de auditoria, com executor e deduplicação.                       |
| 02 — autorização antiga       | Todas as gravações do painel exigem autorização válida; falha de revalidação bloqueia a gravação.                          |
| 03 — punições renovadas       | Geração persistente, exclusão mútua, compensação e validação da punição vigente antes da reversão.                         |
| 04 — snapshot de lock perdido | Snapshot preservado até confirmar a restauração no Discord.                                                                |
| 05 — tarefas perdidas         | Reserva com prazo, conclusão após sucesso, tentativas progressivas e falhas terminais visíveis.                            |
| 06 — dependências             | Next/eslint-config-next 16.4.1, Zod 4.6.6 e overrides corrigidos; auditoria de produção sem avisos.                        |
| 07 — unlock antigo            | A reversão exige a identidade do lock que a originou.                                                                      |
| 08 — entrega de logs          | Lotes respeitam 6.000 caracteres e 10 embeds; falhas transitórias voltam à fila; descartes têm métrica.                    |
| 09 — executor incorreto       | Correlação por delta, espera pela propagação e rejeição de resultados ambíguos.                                            |
| 10 — tickets privados         | Validação das permissões necessárias para o suporte acessar e responder.                                                   |
| 11 — autor assume ticket      | Claim exige permissão de equipe, separada do direito de fechar o próprio ticket.                                           |
| 12 — inatividade              | Atividade persistida, reconciliação após reinício e fechamento condicional.                                                |
| 13 — concorrência em tickets  | Reserva e contador transacionais por servidor, com compensação em falhas.                                                  |
| 14 — reaction roles           | IDs preservados ao editar; seleções obsoletas rejeitadas; atualização de painel não duplica mensagem em falha transitória. |
| 15 — configuração parcial     | Gravações relacionadas de configuração e painéis executadas em transações.                                                 |
| 16 — saúde do YouTube         | Saúde separada por fonte, falhas visíveis no painel e alertas mesmo quando a outra fonte funciona.                         |
| 17 — backup sem repetição     | Novas tentativas a cada 15 minutos até sucesso; marcador diário persistente.                                               |

Também foram persistidos os atrasos curtos de autorole e adicionados readiness
autenticado e métricas de descarte. As três advertências de lint foram corrigidas.

As migrações **0027 e 0028** devem preceder a nova versão do bot e do painel.
Locks legados permanecem sem confirmação de aplicação: o código antigo salvava
o snapshot antes de chamar o Discord. A recuperação exige verificar o canal e
confirmar explicitamente a restauração, conforme o runbook.

Discord e PostgreSQL não compartilham uma transação. Quando uma interrupção não
permite saber se o efeito ocorreu, o bot conserva evidências, suspende a ação
incerta e alerta para reconciliação. Lembretes usam nonce na janela curta de
repetição; fora dela, uma entrega incerta não é reenviada automaticamente.
Isso não representa garantia de execução exatamente uma vez.

A auditoria completa das ferramentas de desenvolvimento também foi tratada:
o comando usado pela CI (`pnpm audit --audit-level high`) passou. A ressalva
de `deepmerge` sem versão corrigida e a exceção histórica de `braces` estão
registradas em [Auditoria de dependências](security-audit.md). Não se afirma
que toda a árvore de ferramentas esteja livre de avisos.

### Validação final das correções

- **1.279 testes em 122 arquivos**, incluindo integrações com PostgreSQL local.
- Typecheck, lint, build, `db:check` e `git diff --check` aprovados.
- `db:generate` confirmou que não há diferenças de schema sem migração.
- Todas as migrações aplicadas em banco local novo; dump local comprimido
  restaurado com 30 tabelas e 29 registros de migração conferidos.
- Imagem `linux/amd64` construída; runtime Node 22.23.4 carregou as oito
  dependências externas, validou a sintaxe do bundle e executou como UID 1000,
  sem rede. O Docker local não oferece BuildKit: foi usada uma cópia temporária
  do Dockerfile removendo apenas o mount opcional de cache do pnpm.
- Revisão independente dos fluxos de autorização, concorrência e falhas parciais.

Os erros de teste expostos pela atualização do Vitest foram reproduzidos também
com uma rejeição mínima. As asserções web agora conferem instância `Error` e
mensagem exata; os cenários de autorização e rollback continuam cobertos.

Essas verificações são locais. O usuário autorizou os commits e o push para
`main`, que aciona o workflow de deploy. O resultado da publicação deve ser
conferido no workflow; os novos eventos no Goodivers exigem observação posterior.

## Resultado

A repetição do cargo **Helldiver** no `log-membros` do Goodivers tem uma causa confirmada: o logger compara o estado atual do membro com um estado anterior **parcial**, após a remoção do membro do cache. Os cargos existentes passam a parecer novos. O comportamento foi reproduzido com o discord.js instalado e o handler real, sem qualquer alteração no Discord.

Também foram encontrados problemas de autorização sob falha de comunicação, expiração de punições, recuperação de canais trancados, execução de tarefas agendadas, entrega de logs, tickets, reaction roles, configuração do painel, monitoramento do YouTube e repetição de backups. Há dependências com avisos de segurança publicados. A suíte existente passa, mas não cobre os cenários que reproduziram os defeitos.

A etapa inicial produziu documentação, sem corrigir código. As correções locais
posteriores estão descritas acima; as observações de produção desta análise
precedem a publicação dessas correções.

## Escopo, método e limites

- Checkout e imagem do bot em produção: `518361fcd5854dccf1576f86e7293f8f9cc7dc21`.
- Inspeção de bot, comandos/interações, eventos, serviços, API, jobs, painel, autenticação/autorização, configurações compartilhadas, repositórios de banco, testes, Docker e backup.
- Consultas de produção somente de leitura: saúde, recursos, logs, configurações pertinentes, metadados do banco, canal `log-membros` e audit log de alterações de cargos.
- Build, lint, tipos e testes locais; migrações e suíte de integração em PostgreSQL 17 local isolado.
- Reproduções adicionais com componentes reais e dependências externas simuladas: membros fora do cache, renovação de timeout, falha de unlock, lote de logs acima do limite e seleção de cargos com IDs obsoletos.
- Consulta de avisos de dependências e documentação oficial de Discord/discord.js.

Não foram executadas ações de moderação, abertura de tickets ou alterações de cargos em produção. Não houve teste manual completo de todas as telas do painel, teste de carga, pentest externo, teste de entrega do webhook de alerta ou restauração de um backup de produção. A versão efetivamente publicada do painel na Vercel não foi verificada; os achados de dependências do painel se referem ao checkout. Não se afirma ausência de outros bugs ou comprometimento de produção.

Classificação: **P1** exige correção prioritária por segurança ou efeito operacional relevante; **P2** é uma falha funcional ou de confiabilidade a corrigir na sequência. “Inspeção” identifica um fluxo concreto no código, mas não significa que o incidente tenha ocorrido em produção.

## Estado observado em produção

| Área              | Evidência em 28/10/2026                                                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Bot               | Versão 2.0.0, Node 22.23.3, aproximadamente 14,7 dias de uptime                                                                          |
| Saúde autenticada | `ok: true`, gateway conectado, ping 123 ms, banco 7 ms                                                                                   |
| Servidores        | 2 em cache, 2 esperados                                                                                                                  |
| Filas             | Logs, cache de mensagens e estatísticas sem pendências na consulta                                                                       |
| Memória/disco     | RSS aproximadamente 70 MiB; disco 16% ocupado                                                                                            |
| Banco             | Aproximadamente 13 MB; 28 tabelas públicas com RLS habilitado; sem grants de tabela para `anon`, `authenticated` ou `PUBLIC` na consulta |
| Backup            | Arquivo de 28/10 às 06:11 UTC, 41.678 bytes, considerado recente; `gzip -t` passou                                                       |
| Tarefas agendadas | Nenhuma linha na tabela no momento consultado                                                                                            |
| Logs em 168 horas | 109 avisos de feed do YouTube: 90 respostas 404 e 19 respostas 500; nenhum registro de nível error/fatal na amostra                      |

Esses números são fotografias do momento. Saúde verde e RLS habilitado não comprovam correção de todos os fluxos nem eficácia de todas as políticas. Integridade do gzip não equivale a restauração validada.

## 01 — P2: cargos existentes registrados como adicionados

**Evidência: produção + reprodução local confirmada.**

O cargo configurado chama-se **Helldiver**, no singular. Foram lidas as 63 mensagens acessíveis do canal na consulta, cobrindo 14/09 a 27/10; 30 mencionavam esse cargo. Essa contagem inclui alterações possivelmente legítimas e não representa 30 falsos positivos comprovados.

As repetições recentes aparecem junto de outro cargo existente, sem executor identificado. Exemplo: [registro de 26/10 às 21:13 BRT](https://discord.com/channels/1316158165645000806/1548879509229408306/1564431789286490353). A consulta ao audit log de alterações de cargos retornou 51 entradas desde 14/09, com a mais recente em 27/09: nenhuma alteração correspondente às repetições de outubro. Há alterações legítimas antigas em setembro.

No Goodivers, `autorole.enabled` está ativo, mas as listas de cargos humanos e bots estão vazias. A verificação está desativada; sua configuração conserva o ID do Helldiver, sem executar essa atribuição. Reaction roles está desativado. Portanto, essas configurações atuais não explicam novas concessões automáticas desse cargo.

**Causa:** `apps/bot/src/client.ts:31` habilita `Partials.GuildMember`; o cache comporta 200 membros por guild e a varredura horária remove todos, exceto o próprio bot. No próximo `guildMemberUpdate` de um membro ausente, o discord.js pode fornecer um `oldMember` parcial, sem seus cargos anteriores. `apps/bot/src/events/logs/members.ts:103` não verifica `oldMember.partial`; o diff de cargos, em torno da linha 149, considera todos os cargos atuais como adições.

Reprodução usando o `GuildMemberUpdate` real do discord.js 14.27.0 e o logger do projeto:

1. Membro em cache, evento sem mudança de cargos: nenhum log.
2. Remoção do membro do cache, mesmo payload: log de adição do Helldiver.
3. Nova remoção do cache, mesmo payload: o mesmo falso log outra vez.

Isso explica por que ocorre com alguns membros e reaparece. A varredura e o limite do cache eliminam o histórico; uma atualização posterior dispara a comparação incorreta. Não é necessário que alguém retire ou conceda o cargo. A mesma premissa de estado anterior desconhecido também precisa ser tratada nos diffs de apelido e avatar.

**Correção:** não calcular alterações a partir de um estado parcial. Buscar o membro depois do evento recupera o presente, não o passado. Para preservar logs de mudanças legítimas de membros fora do cache, usar deltas do audit log com deduplicação ou um histórico anterior confiável e limitado. Manter o teto de memória. `apps/bot/src/services/welcome.ts:29` já protege uma transição contra `before.partial` e oferece um precedente interno.

**Regressão:** membro completo sem mudança; membro parcial sem mudança; adição/remoção real; repetição após varredura; apelido/avatar sem estado anterior. [Referência sobre partials](https://discordjs.guide/legacy/popular-topics/partials).

## 02 — P1: permissão revogada pode continuar autorizando gravações

**Evidência: inspeção do fluxo de autorização.**

Em `apps/web/lib/auth/require.ts:39`, uma autorização antiga é revalidada. Se `resolveGuildLevel` falhar, o fluxo reutiliza o nível salvo na sessão. `apps/web/auth.ts:119` também preserva o grant anterior e posterga a próxima tentativa com `retryAt()`. Falhas repetidas prolongam essa condição.

Um administrador que perdeu a permissão pode continuar passando por `requireGuildAccess` durante indisponibilidade da API do bot. Isso afeta gravações diretas no banco, como `apps/web/lib/module-config.ts:195`; essas operações não dependem de uma segunda autorização no bot. Não foi demonstrado abuso em produção.

**Correção:** bloquear gravações quando não for possível comprovar a permissão atual; definir separadamente uma política de leitura com dados antigos. Não atualizar a validade de um grant como se a revalidação tivesse sido bem-sucedida.

**Regressão:** login como admin, revogação no servidor, grant vencido e respostas 503/429/timeout do verificador; nenhuma configuração deve ser gravada. Os testes existentes de `isStale`/`retryAt` não substituem esse fluxo completo.

## 03 — P1: expiração antiga pode desfazer uma punição renovada

**Evidência: reprodução com serviços reais e PostgreSQL local.**

`apps/bot/src/services/moderation.ts:102`, `:183` e `:357` criam ações de desfazer punições sem substituir as pendências da punição anterior. `apps/bot/src/services/scheduler.ts:166` executa a reversão sem confirmar que a tarefa ainda corresponde à punição vigente.

Aplicar timeout de 60 segundos e depois renová-lo para 600 segundos deixou duas tarefas pendentes. Ao executar a tarefa mais antiga, o scheduler removeu o timeout novo. O mesmo desenho permite que o unban de um ban temporário anterior desfaça uma punição posterior, inclusive convertida em permanente.

**Correção:** vincular cada reversão a uma versão/identificador da punição e substituir pendências de forma transacional. Revalidar essa identidade antes de chamar o Discord. Para timeout, considerar a expiração nativa do Discord e garantir que intervenções posteriores de moderadores sejam respeitadas.

**Regressão:** renovação, encurtamento, conversão para permanente, remoção manual seguida de nova punição e alteração externa no Discord.

## 04 — P1: falha ao destrancar canal apaga os dados de restauração

**Evidência: reprodução com serviço real, banco local e falha REST simulada.**

`apps/bot/src/services/locks.ts:99` executa `deleteChannelLock` antes de restaurar as permissões no Discord. Se essa chamada falhar, o canal permanece trancado e o snapshot original já desapareceu do banco.

Na reprodução, após a falha de rede, o registro não existia, `SendMessages` continuava negado e a segunda tentativa devolvia `not-locked`.

**Correção:** preservar o snapshot até a restauração ser confirmada; controlar concorrência e apagar somente o registro da operação que concluiu. Uma reserva/estado intermediário é preferível a apagar antes do efeito externo.

**Regressão:** timeout REST, 403, falha transitória, repetição e duas solicitações simultâneas de unlock.

## 05 — P1: scheduler considera concluídas tarefas ainda não executadas

**Evidência: inspeção de persistência e execução.**

`packages/db/src/repositories/cases.ts:218` seleciona tarefas com `SKIP LOCKED` e grava `doneAt` durante a reserva do lote, antes de executar os efeitos. `apps/bot/src/services/scheduler.ts:112` processa o lote; uma falha é registrada, sem devolver a tarefa para nova tentativa.

Esse comportamento é deliberado nos comentários, para evitar duplicação, mas troca duplicação por perda definitiva. Uma interrupção após reservar 25 tarefas pode perder as ainda não executadas; uma falha temporária ao remover ban ou restaurar canal pode deixar o estado indefinidamente ativo. Não havia tarefas em produção na consulta, portanto não foi constatada uma ocorrência atual.

**Correção:** separar reserva de conclusão, com prazo de reserva, contador de tentativas, espera progressiva e estado terminal para inspeção. Cada ação precisa tolerar repetição e só receber conclusão após sucesso ou confirmação de que seu efeito já ocorreu.

**Regressão:** reinício após reserva, falha no meio do lote, dois workers e falha transitória no Discord. Cobrir conjuntamente a identidade das punições e dos locks.

## 06 — P1: dependências de produção com avisos de segurança

**Evidência: `pnpm audit --prod --audit-level high --json` e avisos publicados.**

Foram reportados **14 avisos: 2 críticos, 5 altos, 5 moderados e 2 baixos**, sobre 286 dependências de produção. Contagem de avisos não equivale a 14 vulnerabilidades exploráveis neste produto.

| Dependência resolvida              | Versão corrigida indicada | Avaliação                                                                |
| ---------------------------------- | ------------------------- | ------------------------------------------------------------------------ |
| Next 16.3.8                        | 16.4.1                    | Dois avisos críticos condicionais e um alto de DoS em Server Actions     |
| Zod 4.6.5                          | 4.6.6                     | Aviso alto de consumo de memória em validação de coleções com restrições |
| Undici 6.28.1, via discord.js/REST | 6.29.1                    | Avisos altos e moderados envolvendo HTTP, TLS e WebSocket                |
| fast-uri 3.1.7, via resolvers/Ajv  | 3.1.9                     | Avisos moderados e baixos                                                |

Os avisos críticos do Next dependem de configurações/uso específicos de otimização de SVG ou de `use cache` retornando typed arrays. No código inspecionado, não foram encontrados `dangerouslyAllowSVG`, ativação de Cache Components, uso dessa diretiva ou importação de `next/image`. **Não foi demonstrado um caminho de RCE neste aplicativo.** Já App Router e Server Actions estão presentes, tornando o aviso de DoS diretamente relevante para a triagem.

**Correção:** atualizar para versões corrigidas compatíveis, conferir a árvore transitiva e repetir auditoria, build e testes. Validar a versão realmente publicada do painel. Fazer publicação em etapa própria, com autorização de produção. A exceção antiga de `braces` documentada em `docs/security-audit.md` não cobre esses novos avisos.

Fontes: [Next/SVG](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw), [Next/use cache](https://github.com/vercel/next.js/security/advisories/GHSA-673q-mjm6-r5xr), [Next/Server Actions](https://github.com/vercel/next.js/security/advisories/GHSA-p3m5-59mp-jv5r), [Zod](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), [Undici/content encoding](https://github.com/advisories/GHSA-xjj6-f33q-929c), [Undici/TLS](https://github.com/advisories/GHSA-2m5v-pch6-74hx), [Undici/renegociação](https://github.com/advisories/GHSA-qrxm-fqhp-jwvm).

## 07 — P2: unlock agendado antigo pode desfazer um lock novo

**Evidência: inspeção dos comandos e scheduler.**

O comando em `apps/bot/src/commands/utilities/lock.ts:97` agenda unlock associado ao canal. Destrancar manualmente não invalida essa tarefa. Se o canal for trancado novamente antes do horário original, `apps/bot/src/services/scheduler.ts:215` pode destrancar o novo lock.

**Correção:** associar tarefa ao identificador/versão do lock e invalidar pendências ao encerrar ou substituir a operação. Não basta identificar o canal.

**Regressão:** lock temporário → unlock manual → novo lock → vencimento do primeiro; o segundo deve permanecer ativo.

## 08 — P2: fila pode descartar logs grandes ou que falham temporariamente

**Evidência: reprodução da fila real com rejeição simulada do Discord.**

`apps/bot/src/services/log-queue.ts:220` limita o lote a 10 embeds, mas não soma seus caracteres. O Discord também exige até 6.000 caracteres combinados nos embeds da mensagem. Dois embeds válidos de 4.000 caracteres produzem uma mensagem inválida.

Além disso, a fila remove o lote antes do envio (`:149`) e o reintegra apenas no caso tratado de rate limit. Falhas genéricas, inclusive transitórias, podem descartá-lo (`:175`). Na reprodução, o lote de 8.000 caracteres foi rejeitado e a fila terminou vazia, sem uma segunda tentativa.

**Correção:** respeitar simultaneamente quantidade de embeds e caracteres agregados, contando todos os campos sujeitos ao limite. Separar payload inválido de falha transitória; aplicar tentativas limitadas, observabilidade de descarte e divisão do lote quando apropriado.

**Regressão:** limite exato, dois embeds cuja soma excede o limite, 429, 500 e timeout. [Limites oficiais de embeds](https://docs.discord.com/developers/resources/message#embed-limits).

## 09 — P2: identificação do executor no audit log é ambígua

**Evidência: inspeção; atribuição incorreta não reproduzida em produção.**

`apps/bot/src/lib/audit-log.ts:47` busca apenas cinco entradas recentes e cruza tipo, alvo e janela de 10 segundos. Não compara os deltas dos cargos nem deduplica o ID da entrada. Duas ações sobre o mesmo membro em sequência podem reutilizar uma entrada ou associar o executor errado. O timeout da requisição não espera a propagação de uma entrada ainda ausente.

**Correção:** cruzar mudanças específicas, deduplicar entradas e lidar com atraso de propagação. Quando a correlação não for segura, indicar executor desconhecido. Integrar com a correção do item 01.

**Regressão:** dois moderadores alterando cargos do mesmo membro; várias entradas simultâneas; entrada que aparece com atraso.

## 10 — P2: cargo de suporte não garante acesso a ticket em thread privada

**Evidência: inspeção e regras de permissão do Discord.**

`apps/bot/src/services/tickets.ts:314` cria thread privada e adiciona somente o autor. Os cargos de suporte são usados nas permissões do modo canal, mas não tornam seus membros automaticamente participantes da thread privada. Sem participação explícita ou `ManageThreads`, o atendente não consegue vê-la.

**Correção:** definir e validar o modelo de acesso de suporte para esse modo. Se depender de `ManageThreads`, comunicar e validar a exigência; avaliar o alcance dessa permissão. Outra opção é incluir explicitamente os atendentes necessários.

**Regressão:** autor, suporte sem `ManageThreads`, suporte convidado e administrador. [Regras oficiais de threads privadas](https://support.discord.com/hc/en-us/articles/4403205878423-Threads-FAQ).

## 11 — P2: autor pode assumir o próprio ticket e impedir o claim da equipe

**Evidência: inspeção das duas entradas do fluxo.**

`apps/bot/src/interactions/tickets.ts:67` considera o autor autorizado em `canManage`; `:168` reutiliza essa decisão para assumir o ticket. `apps/bot/src/commands/community/ticket.ts:21` e `:214` repetem a mistura de permissões. O repositório permite claim apenas quando `claimedBy` está vazio (`packages/db/src/repositories/tickets.ts:287`).

O autor, que deveria poder encerrar seu atendimento, também pode se tornar seu responsável e bloquear o claim normal de suporte.

**Correção:** separar permissões de encerrar e de assumir. Claim deve exigir a condição de atendente definida pelo produto; prever transferência/reabertura administrativa quando necessário.

**Regressão:** autor consegue encerrar, mas não assumir; equipe consegue assumir; claims concorrentes preservam um único responsável.

## 12 — P2: fechamento automático por inatividade é configurável, mas não executado

**Evidência: campo presente no schema/painel e ausente do runtime do bot.**

`autoCloseInactiveHours` existe em `packages/shared/src/config/tickets.ts:33` e no formulário `apps/web/app/g/[guildId]/config/tickets/form.tsx:66`, mas não é consumido em `apps/bot/src`. A configuração cria uma expectativa que o bot não cumpre.

**Correção:** implementar o acompanhamento de atividade e o job com regras explícitas de prazo, aviso e fechamento; até estar funcional, retirar/desabilitar o controle com indicação correta ao usuário.

**Regressão:** atividade renova o prazo, ticket inativo fecha uma vez, reinício preserva o vencimento e zero desativa o recurso.

## 13 — P2: abertura simultânea de tickets tem corrida de limite e numeração

**Evidência: inspeção das operações separadas.**

`apps/bot/src/services/tickets.ts:248` verifica a contagem antes de criar o canal e inserir o ticket. Duas chamadas simultâneas podem observar a mesma contagem e ultrapassar o limite. `packages/db/src/repositories/tickets.ts:233` aloca número com `max(number) + 1`, sujeito a colisão; o chamador não implementa o retry mencionado no comentário.

Há tentativa de apagar o canal quando a persistência falha, portanto não se afirma que toda colisão deixa canal órfão. Ainda assim, o usuário pode receber falha depois da criação externa, e o limite não está protegido atomicamente.

**Correção:** reservar a abertura sob controle transacional por servidor/usuário e alocar numeração com garantia de concorrência. Coordenar a reserva com a criação no Discord e sua compensação.

**Regressão:** duas aberturas do mesmo usuário próximas ao limite e vários usuários abrindo simultaneamente na mesma guild.

## 14 — P2: editar painel de reaction roles invalida controles e pode remover cargos

**Evidência: inspeção do fluxo salvar → interagir e reprodução da resolução de cargos. Recurso desativado no Goodivers.**

`apps/web/lib/reaction-roles.ts:93` salva o painel e chama `replacePanelItems`. O repositório apaga/recria os itens, gerando novos UUIDs (`packages/db/src/repositories/reaction-roles.ts:162`). Botões já publicados continuam referenciando os IDs anteriores em seu `custom_id` (`apps/bot/src/services/reaction-roles.ts:29`); menus conservam esses IDs nos valores das opções (`:177`).

Até republicar, botões antigos retornam item inexistente. Nos menus, `apps/bot/src/interactions/reaction-roles.ts:106` descarta os valores que não encontra e entrega uma seleção vazia a `resolveSelect`. Nos modos `single` e `toggle`, isso remove os cargos do painel que o membro já possui; em `multiple`, não faz nada. Uma reprodução com a função real confirmou a remoção, mesmo quando o item recriado continuava representando o mesmo cargo. O problema pode surgir após uma edição que só pretendia mudar texto.

**Correção:** preservar IDs dos itens existentes, tratar remoções explicitamente e coordenar persistência/publicação. Rejeitar valores obsoletos antes de calcular mudanças de cargos; não interpretar uma seleção desconhecida como pedido para remover tudo. Se houver estado de rascunho, mostrar com clareza quando a mensagem precisa de atualização.

**Regressão:** editar texto mantendo itens, adicionar/remover item e interagir com a mensagem antes/depois da publicação. Seleções com IDs obsoletos não podem remover cargos nos modos `single`/`toggle`.

## 15 — P2: configurações com várias gravações podem ficar parcialmente salvas

**Evidência: inspeção das gravações e invalidação de cache.**

`apps/web/lib/module-config.ts:125` executa múltiplas operações para configurações gerais e de logs sem uma transação que cubra o conjunto. A invalidação do cache ocorre apenas depois de `writePage`, em torno da linha 205.

Se uma operação intermediária falhar, parte da configuração permanece gravada, o painel informa erro e o bot pode continuar usando o cache anterior até sua expiração.

**Correção:** validar todo o payload, gravar atomicamente e invalidar somente após commit. Tratar falha de invalidação com repetição ou versão de configuração verificável.

**Regressão:** falha induzida na segunda/última gravação não altera parte da configuração; sucesso atualiza o comportamento do bot.

## 16 — P2: falhas do feed do YouTube ficam ocultas no estado da conta

**Evidência: produção + inspeção.**

Nos últimos sete dias houve 109 avisos de falha no feed, sendo 90 respostas 404 e 19 respostas 500. A conta pertinente estava com vídeos e lives habilitados, `failure_count = 0` e `last_checked` recente.

`apps/bot/src/services/social/youtube.ts:384` permite tratar o feed como opcional quando também monitora lives. Em `:455`, uma falha do tipo `SocialProviderError` vira lista vazia quando o feed é opcional; `apps/bot/src/jobs/social.ts:177` registra sucesso/reset de falhas se a outra parte da consulta funciona. Assim, a checagem de lives pode mascarar a indisponibilidade da descoberta de vídeos.

**Impacto confirmado:** monitoramento de vídeos degradado sem refletir isso no contador da conta. Não foi demonstrado que um vídeo específico deixou de ser anunciado; um post pendente, sozinho, não prova perda.

**Correção:** registrar saúde separada de feed de vídeos e consulta de lives; alertar sobre falha persistente de uma fonte mantendo a outra operacional. Investigar a causa dos 404 antes de introduzir mais tentativas cegas.

**Regressão:** live funciona/feed falha; feed funciona/live falha; recuperação e anúncio sem duplicação.

## 17 — P2: backup que falha não é repetido no mesmo dia

**Evidência: inspeção do agendamento. Backup atual válido como gzip.**

`infra/docker-compose.yml:139` marca `LAST` com a data antes de executar o script e ignora seu código de falha no loop. Uma falha pontual impede nova tentativa naquele dia. A condição de horário também precisa ser considerada: apenas mover `LAST` para depois do sucesso ainda limita a recuperação à janela configurada.

**Correção:** marcar sucesso somente após conclusão e permitir tentativas posteriores com limite/espera, independentemente de ainda estar na hora inicial. Alertar sobre falha e verificar periodicamente restauração em banco isolado.

**Regressão:** primeira tentativa falha, próxima funciona; mudança de dia; reinício; falha prolongada gera alerta sem criar arquivo tratado como válido.

## Melhorias adicionais

- Persistir ou reconciliar autoroles com atraso curto: atrasos de até dez minutos ficam em memória e podem desaparecer num reinício (`apps/bot/src/services/autorole.ts:60`). No Goodivers o atraso está em zero; isso não explica o Helldiver.
- No publish de reaction roles, diferenciar mensagem inexistente de falha temporária de busca: `apps/bot/src/services/reaction-roles.ts:231` trata qualquer erro como ausência e pode publicar uma segunda mensagem.
- Separar indicadores de processo vivo e serviço pronto. O `/health` público é liveness; a saúde autenticada tem mais sinais. Monitorar gateway, banco, idade de backup, falhas por fonte social e contadores de logs descartados.
- Revisar documentação e configurações legadas de squads: a PRD 2.1 removeu o produto, mas há referências e flag antiga. Preservar dados até uma decisão explícita de migração/remoção.
- Corrigir os três avisos de lint: dependência instável de `useMemo` na tabela de banidos e dois avisos de compatibilidade de `form.watch` nos formulários de automod/reaction roles.
- Acrescentar testes de comportamento sob falha, reinício e concorrência. A suíte atual valida muitos caminhos normais, mas deixou passar os cinco cenários reproduzidos nesta auditoria.

## Verificação executada

| Verificação                                 | Resultado                                                     |
| ------------------------------------------- | ------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`            | Concluiu sem alterar o lockfile                               |
| `pnpm lint`                                 | Passou: zero erros, três avisos                               |
| `pnpm typecheck`                            | Passou nos cinco pacotes                                      |
| `pnpm build`                                | Passou, incluindo bot e painel Next                           |
| Migrações em PostgreSQL 17 isolado          | Passaram                                                      |
| `pnpm test` com banco local                 | **109 arquivos, 1.195 testes aprovados, nenhum ignorado**     |
| Evento de membro com estado parcial         | Falso log reproduzido com discord.js e handler reais          |
| Renovação de timeout                        | Expiração antiga removeu punição nova                         |
| Falha no unlock                             | Snapshot perdido e canal ainda bloqueado                      |
| Lote de logs de 8.000 caracteres            | Rejeição simulada deixou fila vazia                           |
| Seleção com IDs obsoletos de reaction roles | Resolução real removeu cargos existentes em `single`/`toggle` |
| Backup de produção                          | `gzip -t` passou; restauração não executada                   |

Ambiente local: Node 24.14.1, dentro da faixa suportada pelo projeto, e pnpm 9.15.9. As reproduções adicionais foram scripts temporários, não testes adicionados ao repositório. Nenhum teste de integração foi apontado para o banco de produção.

## Ordem recomendada de correção

1. **Checkpoint pequeno: logger de membros.** Proteger estados parciais e adicionar os testes do Helldiver; revisar correlação com audit log antes de prometer cobertura de membros sem cache.
2. **Segurança:** bloquear gravação com autorização vencida não revalidada e atualizar dependências. Confirmar versões efetivamente implantadas.
3. **Moderação e agendamentos:** identidade de punições/locks, preservação do snapshot e reserva recuperável das tarefas. Tratar como uma mudança coordenada de estado, com testes de falha e concorrência.
4. **Entrega e observabilidade:** tamanho/repetição de logs, saúde por fonte do YouTube e recuperação do backup.
5. **Tickets e painel:** permissões, concorrência, fechamento automático, IDs estáveis e transações de configuração.

Cada checkpoint deve ser revisado e validado antes de uma publicação autorizada. Para encerrar o caso do Helldiver em produção, acompanhar pelo menos um ciclo de varredura do cache e uma alteração legítima de cargo depois da correção, comparando `log-membros` com o audit log do Discord.
