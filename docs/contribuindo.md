# Contribuindo

## 1. Idioma

Documentação, UI e mensagens do bot em **pt-BR**; commits em **inglês** (§7). Nomes de código
(variáveis, funções, tipos, arquivos) em **inglês**.

```ts
// certo
export async function createTicket(guildId: string, userId: string) {
  throw new UserFacingError('Você já tem um ticket aberto.');
}
```

## 2. Antes de escrever código

1. `.harness/architecture.md` — onde a coisa mora e por quê.
2. `.harness/prd.md` — o requisito por trás.
3. `.harness/styleguide.md` — se a mudança toca `apps/web` ou um embed.

A stack está **decidida** (PRD §12). Não proponha Redis, Prisma ou outro
framework web.

## 3. Ferramentas

```bash
pnpm install          # NUNCA npm ou yarn
pnpm dev              # bot + painel
pnpm lint             # ESLint flat config
pnpm typecheck        # tsc --noEmit em todos os pacotes
pnpm test             # Vitest
pnpm build
```

Node 22 LTS (`.nvmrc`). O `engines` recusa 23+.

## 4. As regras que valem em todo lugar

1. **ID do Discord é `string`.** Nunca `Number(snowflake)`.
2. **Todo query filtra por `guildId`,** e nada assume "a" guild — o bot é
   público. No painel, action que escreve recebe o `guildId` no primeiro
   argumento (`useGuildId()` no cliente); rota de `/api/*` o recebe na query.
3. **Todo input externo passa por Zod de `@goodbot/shared`** — opção de comando,
   corpo da API, formulário do painel, jsonb de config. Bot e painel importam o
   **mesmo** schema; duplicar a validação é como as duas pontas divergem.
4. **Config de módulo só pelo `ConfigService`.** Query direta devolve dado
   velho: existe cache.
5. **`pino`, nunca `console.log`** fora de scripts. Nunca logar token, header ou
   conteúdo de mensagem em nível `info`.
6. **`UserFacingError`** para o que vira embed ou toast. O resto sobe e é
   logado. Handler de interação **sempre** responde — efêmero em erro.
7. **Rota nova = Bearer + Zod + rate limit.** Só `/health` fica de fora.
8. **Segredo nunca no repositório.** Só `.env.example`, com comentário. Confira
   `git status` antes de commitar.

## 5. Estilo

ESLint + Prettier na raiz. `pnpm lint` e `pnpm typecheck` **têm** de passar.

- Comentário explica **por quê**, não o quê. Se o código precisa de comentário
  para dizer o que faz, o problema é o código.
- TypeScript estrito. Sem `any` — use `unknown` e estreite.
- `interface` para forma de objeto, união discriminada para máquina de estados.
- Componente shadcn é editado em `apps/web/components/ui`, não reinstalado.

## 6. Testes

Vitest. O que precisa de teste:

- regras de automod
- parsers (duração, snowflake, template)
- schemas Zod com refinement
- helpers de permissão e hierarquia
- qualquer lógica pura com condição não óbvia

Teste que só confirma que o mock foi chamado não vale o custo de manutenção.

## 7. Commits

Conventional Commits **inteiramente em inglês**, assunto e corpo. É a única
parte do projeto que não é em pt-BR: prosa, UI e mensagens do bot continuam
como estão.

```
feat(bot): add /say to publish a message as the bot
fix(web): keep the theme across navigations
chore(infra): raise the body cap on the image routes
docs: describe the guild-as-code flow
```

Escopos: `bot`, `web`, `db`, `shared`, `guild-config`, `infra`, `ci`.

Assunto no imperativo, minúsculo, sem ponto final, até 72 caracteres. O corpo
vai quebrado em 72 colunas e responde **por que**, não o que — o diff já diz o
que. Um commit por tarefa lógica.

## 8. Antes de abrir PR

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

- [ ] os quatro passam
- [ ] mudou schema? migration gerada, **SQL revisado à mão** e aplicada
- [ ] rota nova? Bearer, Zod, `actorId`, rate limit e método no cliente tipado
- [ ] variável nova? documentada no `.env.example`
- [ ] nenhum `.env` no `git status`
- [ ] tela nova? confere contra o `styleguide.md`

A CI (`ci.yml`) roda em todo push e todo PR, com um Postgres de serviço. Ela é
quem reprova o PR com erro de tipo.

## 9. Uma feature está pronta quando dá para rodar

Não entregue código que outra pessoa não consegue testar por falta de
infraestrutura. Se a feature precisa de tabela, a migration vem junto. Se
precisa de variável, ela está no `.env.example`. Se depende de serviço externo,
a configuração está descrita.

O critério: outro dev clona, segue o `primeiros-passos.md` e a feature funciona
— sem setup manual extra.
