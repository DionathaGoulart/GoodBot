# Changelog

Tudo que muda entre uma versão e outra do Goodbot fica aqui. O formato segue o
[Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e as versões
seguem o [SemVer](https://semver.org/lang/pt-BR/): uma versão **major** nova
avisa que algo quebra para quem hospeda (variável de ambiente, formato do
`guild.yaml`, migration que exige passo manual) ou para quem usa (comando que
some ou muda de forma).

## [Não lançado]

Buscar squad no lugar do squad fixo. Quem quer jogar agora não preenche perfil
nem espera match: liga um cargo, entra numa sala e o painel mostra quem está
onde. O estado passou a ser o Discord (cargo, canal, evento agendado), e as
tabelas do módulo antigo caíram. É versão **major**: comandos somem e a
migration apaga dados sem volta.

### Adicionado

- **Cargo `Buscando Squad`**: ligado pelo botão BUSCAR SQUAD, por `/squad
  buscar` ou pela DM que o bot manda quando vê alguém abrir o jogo (só o
  clique liga). Cai sozinho quando a pessoa sai da voz ou não entra em
  nenhuma a tempo, com janela de tolerância para queda de conexão.
- **Cargo `Sem Aviso de Squad`** e `/squad aviso`: quem não quer a DM nunca
  mais a recebe.
- **Salas de voz efêmeras**: entrar no `➕ Criar Squad` cria uma sala
  `Squad <letra grega>` com teto de gente e move a pessoa para ela; vazia, ela
  some depois da janela.
- **Painel fixo** com as salas abertas em tempo real, as próximas jogatinas e
  os botões, publicado por `/squad painel` ou pelo painel web.
- **Jogatina como evento nativo do Discord** (`/squad agendar` ou MARCAR
  JOGATINA): RSVP e lembrete ficam com o Discord, e o bot inicia o evento na
  hora.
- Tela **Buscar squad** no painel web e a rota `POST
  /guilds/:guildId/squads/panel`.
- A intent privilegiada **Presence** passou a ser exigida: sem ela ligada no
  Developer Portal o bot não sobe.

### Removido

- O squad fixo inteiro: perfil por jogo, grade semanal, perguntas, match
  automático e manual, proposta em thread, canal privado com guia, convite e
  votação de entrada, `/bora`, voice reservado, REMARCAR, convidado avulso,
  chamada pública, histórico, números, relatório de fim, `/squad stats` e os
  outros subcomandos antigos, a aba JOGATINAS e as telas de jogos e
  jogadores.
- Migration `0023`: apaga as nove tabelas `squad_*` e os três enums do
  módulo, com os dados. Tire um dump antes (ver o runbook).
- Rotas `/squads` antigas da API interna (retrato, match, arquivar,
  renomear, gestão de jogadores).

## [1.1.0] - 2026-09-22

Jogatinas monitoradas. A presença no voice reservado deixou de servir só para
contar jogatinas: ela passou a medir tempo, e desse tempo saem os números do
squad. A jogatina ganhou remarcação, convidado avulso e chamada pública que
não morre no início.

### Adicionado

- **Números do squad**: horas por pessoa, por tamanho de grupo (solo, dupla,
  trio, party cheia) e por grupo exato, com quem cada um mais joga, e por
  jogatina quem foi, quem faltou e quem apareceu sem avisar. A fonte é só o
  voice das jogatinas marcadas.
- **Relatório de fim de jogatina**: a mensagem da jogatina vira o registro do
  que rolou (duração, quem jogou e por quanto tempo, convidados, formações,
  faltas). É uma edição da mensagem, não um aviso novo: registro não chama
  ninguém de volta.
- **`/squad stats`** com os seus números num jogo (ou os de quem você
  apontar) e o botão **NÚMEROS** no guia, com os do squad inteiro.
- **Aba JOGATINAS no painel**: filtros por jogo, squad e período, resumo,
  tabela com detalhe por jogatina, ranking por jogador, formações e duplas.
  É o único lugar que mostra a jogatina que não rolou, porque jogatina
  cancelada e jogatina vazia não geram relatório no Discord.
- **REMARCAR**: quem está no "vou" muda o horário sem cancelar a jogatina. O
  squad é avisado numa mensagem nova e a sala reservada acompanha o horário
  novo.
- **TRAZER CONVIDADO**: quem é do squad traz alguém de fora para jogar só
  aquela jogatina, com a sala liberada e o aviso numa thread privada, sem
  entrar no squad. O teto por servidor (`maxSessionGuests`, padrão 4, 0
  desliga o botão) é configurável no painel.
- **CHAMAR GENTE durante a jogatina**: a chamada pública vale até o fim, e
  quem é aceito no meio entra no squad e cai direto na sala.
- O guia do squad passou a dizer as horas e a presença média do último mês.
- **Aviso de manutenção no deploy**: antes de reiniciar, o bot avisa nos
  servidores que atende quanto tempo deve ficar fora, e edita o aviso quando
  volta. Depende de `OWNER_DISCORD_ID` na VM, que já existia.

### Corrigido

- Presença no voice das jogatinas tinha dois furos: quem já estava na sala
  quando ela foi reservada (ou quando a jogatina começou) não gerava presença
  nenhuma, e quem saía com o bot fora do ar deixava a presença aberta para
  sempre. Uma varredura acerta os dois na reserva, no início e a cada passada
  do job. O tempo de quem saiu com o bot fora do ar é contado até a varredura
  seguinte: não existe dado melhor.
- Quem entrava no squad com a sala já reservada ficava trancado do lado de
  fora da própria jogatina até a liberação. Agora ganha a sala na hora, e a
  liberação devolve o voice ao que era também para essa pessoa.

### Alterado

- Push na `main` que mexe só no painel ou na documentação não reinicia mais o
  bot.

## [1.0.1] - 2026-09-21

### Corrigido

- O alerta "BOT NO AR", o `/health` e o log de boot mostravam `v0.0.0`: a
  constante `VERSION` não acompanhou a 1.0.0. Um teste agora compara as duas.
- O Dependabot nunca conseguia atualizar o npm: ele roda em Node 24 e o
  `engines` só aceitava o 22. A faixa passou a aceitar 22 e 24; produção
  continua no 22.

### Alterado

- Dependências atualizadas pelo Dependabot. No bot e no painel: Next 16.3.5,
  React 19.3, Zod 4.6, Hono 4.13.8 e recharts 3.10, entre outras. Nas
  ferramentas de desenvolvimento: TypeScript 6, Vitest 5 e dotenv 18.
- O Dependabot não propõe mais versão major do `@types/node`: os tipos
  acompanham o Node 22 que roda em produção.

## [1.0.0] - 2026-09-21

Primeira versão pública. O bot já rodava em produção antes dela; a 1.0.0 marca
o código aberto e o compromisso com o SemVer daqui em diante.

### Bot

- **Moderação** com casos numerados e mod-log: ban (inclusive temporário),
  kick, timeout, warn e notas, sempre com motivo.
- **Automod**: spam, links, caps, palavras, menções em massa e modo anti-raid.
- **Logs** de mensagens, membros, servidor e voz, cada grupo no seu canal.
- **Boas-vindas** e despedida por template, com DM opcional.
- **Autorole** na entrada e verificação por botão.
- **Reaction roles** por botão, menu ou reação.
- **Tickets** com tipos, painel de abertura, transcript e fechamento.
- **Tags**: respostas salvas com autocomplete.
- **Utilidades**: clear, purge, lock, slowmode, lembretes, enquetes e info.
- **Estatísticas** de mensagens, entradas e saídas, voz e casos, por hora e
  por dia.
- **Redes sociais**: aviso de vídeo, short e live do YouTube, sem credencial
  nenhuma (feed RSS e páginas públicas).
- **Squads**: perfil de jogador, match por horário, squad com canal privado,
  jogatina marcada com `/bora`, voice reservado na hora e histórico de quem
  aparece.

### Painel

- Configuração de cada módulo pelo navegador, sem redeploy.
- Membros, cargos e canais do servidor, com toda escrita passando pelo bot.
- Casos com filtros, detalhe, desfazer e exportação CSV.
- Auditoria imutável de tudo que o painel altera.
- Perfil do bot por servidor: apelido, foto, capa e bio.

### Multi-servidor

- Qualquer pessoa pode convidar o bot. O convite normal espera aprovação do
  dono do bot; o de demonstração atende por 1 hora e sai sozinho.
- Quem convidou recebe uma DM a cada mudança de estado do convite.
- Painel do dono (`admin.`): fila de aprovação, bloqueio, saúde, broadcast e
  manutenção.

### Guild como código

- `pnpm guild scan | import | plan | apply`: a estrutura do servidor (cargos,
  categorias, canais e permissões) num `guild.yaml` sem ID nenhum, aplicada de
  forma idempotente e sem apagar nada sem `--allow-delete`.

### Operação

- Deploy por `git push` na `main`: migrations, painel na Vercel e imagem do bot
  no GHCR, nessa ordem.
- Backup diário do Postgres na VM (7 diários e 4 semanais), com restore
  documentado.
- Métricas Prometheus, alerta por webhook, fail2ban na API e runbook de
  incidentes.

### Antes da 1.0

O projeto nasceu como CoBot e foi renomeado para Goodbot em 2026-09-10. As
revisões v1.0 a v1.6 do [PRD](.harness/prd.md) registram como ele chegou até
aqui:

| Revisão | O que entrou                                                  |
| ------- | ------------------------------------------------------------- |
| v1.1    | hospedagem dividida entre Oracle, Vercel e Supabase           |
| v1.2    | o nome Goodbot e a guild como código                          |
| v1.3    | bot público: registro de servidores, convite, demo e `admin.` |
| v1.4    | DMs do ciclo de vida do convite e painel publicado pela CI    |
| v1.5    | módulo de squads                                              |
| v1.6    | jogatina sob demanda, parties, convite com votação, histórico |

[Não lançado]: https://github.com/DionathaGoulart/GoodBot/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/DionathaGoulart/GoodBot/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/DionathaGoulart/GoodBot/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/DionathaGoulart/GoodBot/releases/tag/v1.0.0
