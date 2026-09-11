---
name: reformar-servidor
description: Varre um servidor do Discord que o Goodbot atende e escreve a análise em infra/discord/<slug>/servidor.md, e depois reforma a estrutura (cargos, categorias, canais, permissões) editando o guild.yaml e aplicando pela API do bot. Use quando o pedido for analisar, entender, organizar, reformar, reestruturar ou "transformar em servidor de tal jogo" um servidor do Discord.
---

# Reformar um servidor

Duas fases: **entender** e **mudar**. Nunca pule a primeira — sem o retrato
você está adivinhando os nomes dos canais e cargos que já existem, e o
`guild.yaml` casa tudo por nome.

## 1. Entender

```bash
pnpm guild scan                  # lista os servidores em que o bot está
pnpm guild scan "<nome>"         # varre um e escreve infra/discord/<slug>/
```

`INTERNAL_API_URL` e `INTERNAL_API_TOKEN` saem do `.env` da raiz; não há mais
nada para configurar. O `scan` grava três arquivos:

| Arquivo | Para quê |
| --- | --- |
| `servidor.md` | a análise — leia **este** para se situar |
| `guild.yaml` | a mesma estrutura em forma executável; é o que o `plan` compara |
| `.env` | só o `GUILD_ID` |

Leia o `servidor.md` inteiro antes de propor qualquer coisa, com atenção à
seção **Observações**: ela aponta duplicação, categoria vazia, `@everyone` com
permissão perigosa e o que está fora do alcance do yaml.

O `scan` se autoconfere: depois de escrever, ele monta o plano contra o próprio
yaml, e esse plano tem de sair vazio. Se não sair, ele avisa e sai com erro —
não confie no arquivo antes de entender por quê.

## 2. Mudar

Edite o `guild.yaml`. A ordem das listas é significativa: cargos de cima para
baixo na hierarquia, canais na ordem em que aparecem na categoria.

```bash
pnpm guild plan  --server <slug>     # não escreve nada
pnpm guild apply --server <slug>     # executa depois de confirmar
```

**Sempre rode `plan` primeiro e mostre a saída ao usuário.** Só rode `apply`
com o ok explícito dele: é escrita num servidor real.

O `apply` carimba `Goodbot Reform · <slug>` no audit log do Discord de toda
chamada. O `actorId` que a API exige sai do dono do servidor automaticamente;
o usuário não precisa configurar nada.

## O que sabotar uma reforma

- **Renomear não existe.** Tudo casa por nome. Trocar `Membro` por
  `Membro Verificado` no yaml lê como "criar cargo novo", e o antigo fica lá
  com os membros dentro. Renomeação é o usuário que faz no Discord; depois
  rode `scan --force` para recapturar.
- **Apagar é opt-in.** Sem `--allow-delete` o apply só cria e edita. Com a
  flag, as remoções saem num bloco separado e exigem digitar `APAGAR`. Canal
  apagado leva o histórico junto — proponha remoção, nunca a aplique por conta.
- **Reordenar cargo é caro.** Uma chamada por casa que o cargo anda; fica atrás
  de `--reorder`.
- **Fora do alcance:** fóruns, palcos, tópicos, threads, emojis, stickers,
  eventos e webhooks. O yaml não os representa e o apply não os toca. Se o
  pedido depender de um deles, diga que essa parte é manual.

## Referência

`docs/guild-como-codigo.md` tem o formato completo do `guild.yaml`, e
`infra/discord/exemplo/guild.yaml` é um exemplo comentado.
