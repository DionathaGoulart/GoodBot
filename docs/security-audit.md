# Auditoria de dependências

Em 13/10/2026, o `pnpm audit --audit-level high` encontra a vulnerabilidade
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
(`CVE-2026-93687`) em `braces@3.0.3`, sem versão corrigida publicada. No
CoBot, os caminhos identificados passam apenas por ferramentas de desenvolvimento
(`eslint-config-next` e `shadcn`) que processam arquivos confiáveis do projeto,
sem entrada de usuários em tempo de execução.

O `pnpm.auditConfig.ignoreCves` ignora especificamente esse CVE; ele não corrige
o pacote e a exceção vale globalmente para qualquer caminho futuro. Ao atualizar
dependências, reavaliar se a vulnerabilidade passou a alcançar código de produção
ou entrada não confiável. Remover a exceção assim que houver versão corrigida.

## Correções de 28/10/2026

A [auditoria end-to-end](auditoria-2026-10-28.md) encontrou 14 avisos em
dependências de produção. O checkout foi atualizado para Next/eslint-config-next
16.4.1 e Zod 4.6.6, com overrides transitivos para Undici 6.29.1 e fast-uri 3.1.9.
Após a atualização, `pnpm audit --prod --audit-level low` reportou zero avisos
em 285 dependências de produção. Isso descreve o checkout validado, não uma
publicação no servidor ou na Vercel.

A verificação completa da CI também exigiu atualizar ferramentas de
desenvolvimento: Vitest 5.0.3, Vite 8.2.4, happy-dom 21.0.4, shadcn 4.23.0,
esbuild 0.28.1 e dependências transitivas. Vite foi declarado na raiz para
resolver explicitamente o peer usado pelo Vitest; só o override não atualizava
o peer antigo no pnpm 9. O carregamento da configuração do Drizzle e os builds
foram revalidados junto dessa atualização do esbuild.

`pnpm audit --audit-level high` passou (código de saída 0). Resta um aviso
**low**, [CVE-2026-93753 em deepmerge](https://github.com/advisories/GHSA-gcqx-w48m-w2h4),
sem versão corrigida publicada. Os caminhos encontrados são do CLI shadcn e
de seu registry, instalados como ferramentas de desenvolvimento; não aparecem
na auditoria de dependências de produção. Não foi adicionada exceção para esse
aviso. A exceção histórica de `braces`, descrita acima, permanece e não equivale
a uma correção desse pacote.
