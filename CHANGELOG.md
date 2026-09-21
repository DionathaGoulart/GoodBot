# Changelog

Tudo que muda entre uma versão e outra do Goodbot fica aqui. O formato segue o
[Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e as versões
seguem o [SemVer](https://semver.org/lang/pt-BR/): uma versão **major** nova
avisa que algo quebra para quem hospeda (variável de ambiente, formato do
`guild.yaml`, migration que exige passo manual) ou para quem usa (comando que
some ou muda de forma).

## [Não lançado]

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

[Não lançado]: https://github.com/DionathaGoulart/GoodBot/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/DionathaGoulart/GoodBot/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/DionathaGoulart/GoodBot/releases/tag/v1.0.0
