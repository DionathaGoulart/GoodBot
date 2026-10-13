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
