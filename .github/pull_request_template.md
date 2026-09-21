## O que muda e por quê

<!-- O diff já mostra o que mudou. Conte o porquê e o que quebraria se fosse feito de outro jeito. -->

## Como testar

<!-- Passos para ver a mudança funcionando: comando, tela do painel, evento no Discord. -->

## Checklist

- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` passam
- [ ] mudou schema? migration gerada, **SQL revisado à mão** e aplicada
- [ ] rota nova na API do bot? Bearer, Zod, `actorId`, rate limit e método no cliente tipado
- [ ] variável nova? documentada no `.env.example`
- [ ] nenhum `.env` no `git status`
- [ ] tela nova? confere contra o `.harness/styleguide.md`
- [ ] commits em inglês, no formato Conventional Commits
