# Segurança

## Como reportar uma vulnerabilidade

**Não abra issue pública.** Uma issue fica visível para todo mundo antes da
correção sair, e a instância pública do Goodbot atende servidores reais.

Reporte em privado pelo próprio GitHub: aba **Security** do repositório >
**Report a vulnerability**. Só você e o mantenedor veem o relato, e a correção
pode ser discutida ali mesmo antes de ficar pública.

Ajuda muito incluir:

- o que dá para fazer com a falha (ler dado de outro servidor, agir sem
  permissão, derrubar o bot…);
- os passos para reproduzir, ou uma prova de conceito mínima;
- a versão ou o commit em que você testou.

## O que esperar

- Resposta inicial em até **7 dias**.
- Se a falha for confirmada, a correção sai na versão seguinte e o relato vira
  um advisory público depois do deploy, com crédito para quem reportou (se
  você quiser).

Este é um projeto mantido por uma pessoa só, no tempo livre. Os prazos são um
compromisso de boa-fé, não um SLA.

## Escopo

Entram:

- a API do bot (`apps/bot/src/api`), exposta na internet atrás de um token
  Bearer;
- o painel (`apps/web`): login, verificação de acesso por servidor, server
  actions e rotas;
- o isolamento entre servidores: um servidor nunca pode ler nem alterar dados
  de outro;
- o fluxo de convite, demonstração e aprovação;
- os scripts e a configuração de produção em `infra/`.

Não entram:

- ataques de negação de serviço ou testes de carga contra a instância pública;
- engenharia social, ou acesso físico ou por credencial vazada às contas do
  mantenedor;
- falhas em dependências já corrigidas upstream e só aguardando atualização (o
  Dependabot cuida delas toda semana);
- problemas de uma instância hospedada por terceiros que venham da
  configuração dela, e não do código.

Ao testar, use um servidor seu e a demonstração de 1 hora. Não mexa em dados
de servidores que não são seus.

## Versões com suporte

Só a versão mais recente da `main` recebe correção de segurança.
