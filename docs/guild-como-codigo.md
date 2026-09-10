# Guild como código

Descreve a estrutura de um servidor do Discord num arquivo e aplica de uma vez,
em vez de clicar item por item no painel.

O modelo é o do Terraform: um arquivo diz como o servidor **deve** ser, o
`plan` mostra a diferença entre isso e como ele **está**, e o `apply` executa
só o que falta.

---

## 1. Começando

```bash
cp -r infra/discord/exemplo infra/discord/meu-servidor
$EDITOR infra/discord/meu-servidor/guild.yaml
cp infra/discord/meu-servidor/.env.example infra/discord/meu-servidor/.env
$EDITOR infra/discord/meu-servidor/.env
```

O `.env` precisa de quatro coisas:

| Variável             | O que é                                                     |
| -------------------- | ----------------------------------------------------------- |
| `GUILD_ID`           | ID do servidor (botão direito no servidor > Copiar ID)      |
| `ACTOR_ID`           | **seu** ID de usuário; assina as mudanças na auditoria      |
| `INTERNAL_API_URL`   | onde a API do bot responde (`http://localhost:3001` em dev) |
| `INTERNAL_API_TOKEN` | o mesmo `INTERNAL_API_TOKEN` da VM / do `.env` da raiz      |

Para copiar IDs, ligue **Configurações > Avançado > Modo desenvolvedor** no
Discord.

Depois:

```bash
pnpm guild list                             # servidores configurados
pnpm guild plan  --server meu-servidor      # não escreve nada
pnpm guild apply --server meu-servidor      # executa após confirmar
```

## 2. O arquivo

```yaml
name: Meu servidor # só para quem lê; não é escrito na guild

roles: # de cima para baixo na hierarquia
  - name: Admin
    color: '#e74c3c'
    hoist: true # aparece destacado na lista de membros
    mentionable: false
    permissions: [Administrator]

  - name: Moderador
    permissions: [KickMembers, BanMembers, ManageMessages]

channels: # canais fora de qualquer categoria, no topo
  - name: regras
    type: text
    topic: Leia antes de participar.
    overrides:
      - role: '@everyone'
        view: allow
        send: deny

categories:
  - name: Comunidade
    overrides:
      - role: '@everyone'
        view: allow
        send: allow
    channels:
      - name: geral
        type: text
      - name: memes
        type: text
        slowmode: 5 # segundos
      - name: Sala 1
        type: voice
```

**Campos de `roles`:** `name`, `color` (`#rrggbb` ou inteiro), `hoist`,
`mentionable`, `permissions`. Os nomes de permissão válidos estão em
`packages/shared/src/api/permissions.ts`.

**Campos de `channels`:** `name`, `type` (`text`, `voice`, `announcement`),
`topic`, `nsfw`, `slowmode` (segundos), `overrides`.

**Campos de `overrides`:** `role` (nome do cargo, ou `@everyone`), `view` e
`send`, cada um `allow` / `deny` / `inherit`.

## 3. Por que não há ID nenhum no arquivo

Todo alvo é referenciado por **nome**. Durante o `apply`, o programa mantém um
índice nome → ID que nasce do estado atual do servidor e cresce a cada criação:
a categoria criada no passo 3 é o que dá o ID que o canal do passo 4 usa como
pai.

Isso compra três coisas:

- o arquivo pode ser versionado num repositório **público** sem identificar o
  seu servidor;
- o **mesmo** arquivo serve para servidores diferentes (o que muda é o `.env`);
- o diff continua funcionando depois de qualquer mudança feita pelo painel.

## 4. Idempotência

Rodar duas vezes seguidas não faz nada na segunda vez. O `plan` compara e emite
só a diferença:

```
Plano para "Meu servidor"

  Nada a fazer: a guild já corresponde ao guild.yaml.
```

Um detalhe importante: só as permissões que o produto conhece entram na
comparação. O Discord adiciona permissões novas com o tempo, e o bot preserva
os bits que não conhece ao salvar um cargo — se o diff olhasse o bitfield
inteiro, todo `apply` reescreveria todo cargo para sempre.

## 5. Remoção

Por padrão o `apply` **só cria e edita**. O que existe no servidor e não está
no arquivo é simplesmente ignorado.

Para incluir remoções:

```bash
pnpm guild plan --server meu-servidor --allow-delete
```

O plano então separa as remoções num bloco próprio:

```
REMOVER (2) — irreversível, leva o conteúdo junto:
  - APAGAR canal "antigo" de "Arquivo"
  - APAGAR cargo "Temporário"
```

E o `apply` exige digitar `APAGAR` por extenso. A flag `--yes` **não** pula
essa confirmação: apagar um canal apaga as mensagens dele, e isso não volta.

## 6. Ordem dos cargos

Numa guild nova, a ordem sai certa de graça: cargo criado entra por baixo, e
criar na ordem do arquivo reproduz a hierarquia do arquivo.

Num servidor que já existe e está fora de ordem, é preciso `--reorder`. A API
do bot move um cargo **uma casa por chamada** (é o `▲`/`▼` do painel), então a
operação custa muitas chamadas e o plano avisa quantas:

```
Avisos:
  ! Reordenar cargos custa 14 chamadas: a API move uma casa por vez.
```

## 7. O que este formato não faz

Vale saber antes de tentar:

- **Override só tem `view` e `send`.** É o que a API do bot expõe. As outras
  permissões por canal continuam sendo assunto do Discord.
- **Canal não tem posição.** A ordem é a de criação. Reordenar canal de um
  servidor existente é manual.
- **Renomear é lido como troca.** O casamento é por nome, então mudar `geral`
  para `chat` no arquivo aparece como "criar `chat`" — e, só com
  `--allow-delete`, "apagar `geral`". Renomeie pelo painel e depois ajuste o
  arquivo.
- **Não gerencia**: emojis, stickers, eventos, webhooks, fóruns, palcos e
  tópicos. Alguns têm rota na API e podem entrar depois.
- **Não gera o arquivo a partir de um servidor existente.** Não há `import`.

## 8. Vários servidores

Uma pasta por servidor:

```
infra/discord/
  goodivers/
    guild.yaml
    .env        (gitignored)
  darkning/
    guild.yaml
    .env        (gitignored)
```

```bash
pnpm guild apply --server goodivers
```

## 9. Segurança

O que **nunca** pode ir para o repositório:

- `INTERNAL_API_TOKEN` e `DISCORD_TOKEN`
- códigos de convite permanentes (quem tem o código entra no servidor)
- URLs de webhook (quem tem a URL publica como se fosse o bot)
- lista de banidos com motivo e IDs de membros — dado pessoal de terceiros

`GUILD_ID` e `ACTOR_ID` não são segredos no sentido estrito (qualquer membro vê
o ID do servidor), mas identificam **qual** servidor é o seu. Por isso ficam no
`.env`, que o `infra/discord/.gitignore` mantém fora do versionamento.

Se o repositório é público, vale mais uma olhada nos **nomes** de canal antes
de commitar: `denuncias-staff` e `logs-mods` contam sobre a operação interna do
servidor mesmo sem revelar ID nenhum.

## 10. Requisitos do lado do Discord

Para o `apply` funcionar:

1. O bot precisa estar no servidor com `ManageChannels` e `ManageRoles`.
2. O **cargo do bot precisa estar acima** de todo cargo que ele vai criar ou
   editar. Regra do próprio Discord; sem isso a operação falha com
   `BOT_ROLE_HIERARCHY`.
3. O `ACTOR_ID` precisa ser admin do servidor. Idealmente o **dono**: a API
   recusa conceder uma permissão que o próprio ator não tem
   (`GRANT_ABOVE_ACTOR`), e o dono é a única exceção a essa regra.

## 11. Quando algo falha

O `apply` não para no primeiro erro: ele registra a falha, segue e mostra o
resumo no fim.

```
  [7/15] FALHA criar canal "logs" em "Staff" — Sem permissão para gerenciar canais.

12 de 15 aplicadas.
3 falharam. Rode "plan" de novo para ver o que sobrou.
```

Como o `plan` é sempre recalculado contra o estado real, corrigir o problema e
rodar de novo aplica exatamente o que faltou — nada é feito duas vezes.

| Erro                 | Causa                                                       |
| -------------------- | ----------------------------------------------------------- |
| `UNAUTHORIZED`       | `INTERNAL_API_TOKEN` errado ou ausente                      |
| `BOT_ROLE_HIERARCHY` | cargo do bot está abaixo do alvo                            |
| `GRANT_ABOVE_ACTOR`  | o `ACTOR_ID` não tem a permissão que está tentando dar      |
| `ROLE_NOT_FOUND`     | o spec cita um cargo que não existe e não está sendo criado |
| 503 com `retryAfter` | rate limit; o apply já espera e tenta de novo uma vez       |

## 12. Referência do CLI

```
pnpm guild list
pnpm guild plan  --server <slug> [--allow-delete] [--reorder]
pnpm guild apply --server <slug> [--allow-delete] [--reorder] [--yes] [--interval <ms>]
```

| Flag             | Efeito                                                         |
| ---------------- | -------------------------------------------------------------- |
| `--allow-delete` | inclui remoções. Sem isto o apply só cria e edita              |
| `--reorder`      | corrige a ordem dos cargos (uma chamada por casa)              |
| `--yes`          | pula a confirmação. Remoção continua exigindo digitar `APAGAR` |
| `--interval`     | pausa entre chamadas em ms (padrão 120)                        |

O padrão de 120 ms existe porque quem apresenta o token cai no teto de 600
requisições por minuto da API do bot. A folga deixa o painel continuar usável
enquanto um `apply` longo roda.
