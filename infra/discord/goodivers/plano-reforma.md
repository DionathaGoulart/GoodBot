# Plano de reforma — Goodivers

Levantado em 2026-09-11 a partir de `servidor.md`, do perfil ao vivo da guild e
das restrições reais do `guild.yaml`. Nada aqui foi aplicado.

Objetivo: cara de Helldivers 2, estrutura moderna, Modo Comunidade ligado — sem
perder um único webhook.

---

## 0. A regra que manda em todo o resto

Em `packages/guild-config/src/plan.ts:143` o canal é identificado por
**(categoria, nome)**:

```ts
const channelKey = (parentId: string | null, name: string): string =>
  `${parentId ?? ''} ${norm(name)}`;
```

Consequência direta, e é a coisa mais importante deste documento:

| Ação no yaml | O que acontece de verdade |
| --- | --- |
| Renomear um canal | canal **novo**, ID novo. O antigo fica (ou some com `--allow-delete`) |
| Mover canal de categoria | idem: `create` na nova, `delete` na antiga |
| Renomear categoria | idem, e arrasta todos os filhos junto |
| Renomear cargo | cargo **novo**, vazio. O antigo fica, com os membros dentro |

**Webhook vive preso ao ID do canal.** Canal recriado = feed do Helldivers 2
morto, e o webhook precisaria ser refeito do zero no painel do Discord.

Por isso este plano separa tudo em duas colunas: **o que o yaml faz** (criar,
editar permissão, tópico, slowmode, cor de cargo) e **o que é manual no
Discord** (renomear, mover, converter tipo, Modo Comunidade). Renomear e mover
pela interface do Discord **preserva o ID** — é por isso que a mão vence o
arquivo nesses casos.

---

## 1. Zona intocável

Estes três canais são o motivo do plano existir com tanto cuidado:

| Canal | ID | Papel |
| --- | --- | --- |
| `#boletins-oficiais` | `1470577621883683087` | feed HD2 |
| `#ordens-superiores` | `1470578624280400087` | feed HD2 (Major Orders) |
| `#comunicados-oficiais` | `1470578555560788130` | feed HD2 |
| categoria `Novidades` | `1545799901596876941` | a categoria dos três |

**No yaml, estes quatro nomes não mudam um byte, e nenhum sai de `Novidades`.**
O yaml só pode encostar em tópico, slowmode e overrides deles — o que basta
para o que este plano precisa.

> ⚠️ **Confirme comigo:** eu tentei ler as mensagens desses canais pela API do
> bot para provar que o webhook está neles, e a rota voltou vazia nos cinco
> canais que testei (inclusive nos que certamente têm conversa), então o teste
> não vale como prova. Assumi pelos nomes e pelo padrão só-leitura. **Se algum
> feed estiver em outro canal, me diga antes de aplicar qualquer coisa.**

`#boas-vindas` (`1545799712190242916`) também não se mexe pelo yaml: ele é o
**system channel** da guild, e recriá-lo quebraria essa ligação.

---

## 2. O estado de hoje, em números

| | |
| --- | --- |
| Membros | 11 |
| Modo Comunidade | **desligado** (`features` não tem `COMMUNITY`) |
| Nível de verificação | **Nenhum** (`0`) |
| Boosts | 0 (tier 0) |
| Descrição da guild | vazia |
| Canal de sistema | `#boas-vindas` |
| Canal AFK | `Criogenia` |
| Cargos | 15, dos quais **10 são pura casca** (nome + cor + hoist) |
| Canais | 10 em 2 categorias, 2 soltos |

**Uma observação que vale mais que qualquer estrutura nova:** são 11 membros.
Servidor pequeno morre de canal vazio, não de falta de canal. Este plano cria
**quatro** canais, não quinze. A régua é: cada canal novo precisa de um dono
claro e de uma razão pra ser aberto na semana 1.

---

## 3. Fase 0 — Modo Comunidade (manual, ~10 min)

A API do bot **não expõe** o toggle: `GuildSettingsInputSchema` cobre nome,
descrição, nível de verificação, canal de sistema, AFK, ícone e banner, e mais
nada. Ligar Comunidade é mão no Discord.

**Pré-requisitos que o Discord exige antes de deixar ligar:**

1. Nível de verificação **Baixo** ou acima — hoje é Nenhum.
   Este o bot faz: `PATCH /guilds/:id` com `verificationLevel`, ou o painel em
   **Servidor**. Deixe em **Médio** (conta de e-mail verificada + 5 min no
   Discord): filtra bot de raid sem atrapalhar convidado legítimo.
2. **Filtro de conteúdo explícito = todos os membros** — manual.
3. **Notificação padrão = apenas menções** — manual, e obrigatório. Com
   Comunidade ligada e notificação em "todas as mensagens", todo mundo sai.
4. Um canal de regras e um canal de updates da comunidade. O de regras é o
   `#protocolo` da Fase 1; o de updates pode ser `#comunicados-oficiais`.

**O que ligar Comunidade destrava, e o que vamos usar:**

| Recurso | Usa? | Por quê |
| --- | --- | --- |
| **Canais de Anúncio** | ✅ sim | os três feeds HD2 viram "seguíveis": outro servidor segue e recebe os posts. É o maior ganho isolado deste plano |
| **Onboarding / Guia do Servidor** | ✅ sim | substitui o fluxo de "reaja pra entrar" por telas nativas |
| **AutoMod nativo** | ⚠️ talvez | o bot já tem módulo de automod próprio (`docs/modulos.md`). Ligar os dois é conflito; escolher um |
| **Fóruns** | ⏳ depois | bom para `#relatorios-de-missao` quando passar de ~50 membros. Fora do alcance do yaml |
| **Palcos** | ❌ não | 11 membros não enchem um palco |
| **Descoberta** | ❌ não | exige 100+ membros |

**Conversão dos feeds para Canal de Anúncio:** manual, em cada canal >
Configurações > "Transformar em canal de anúncio". **Preserva o ID e o
webhook.** Pelo yaml seria impossível: `ChannelUpdateInputSchema` não tem
`type`, e o próprio `plan.ts:255` avisa que "o Discord não converte tipo de
canal".

---

## 4. Fase 1 — Estrutura (yaml, reversível)

Tudo aqui é `create`. Nada é apagado, nada é renomeado, nada se move.

### Categoria nova: `PONTE DE COMANDO`

Fica no topo. É o que um recruta vê primeiro.

| Canal | Tipo | Config |
| --- | --- | --- |
| `#protocolo` | texto | `@everyone` vê, não escreve. Vira o canal de regras da Comunidade |
| `#cargos` | texto | `@everyone` vê, não escreve. Recebe o painel de reaction-roles da Fase 3 |

### Categoria nova: `GUERRA GALÁCTICA`

| Canal | Tipo | Config |
| --- | --- | --- |
| `#relatorios-de-missao` | texto | clipes e prints. **slowmode 30s** — é o canal que vira enxurrada |
| `#recrutamento` | texto | procurar esquadrão. Onde o cargo `📡 Esquadrão` é pingado |

### O que fica exatamente como está

- `Novidades` + os três feeds — zona intocável
- `Área Social` com `#sala-de-comando` e as quatro salas de voz. `#sala-de-comando`
  continua sendo o chat geral; criar um `#frente-de-batalha` ao lado só
  dividiria 11 pessoas em dois canais mortos
- `#boas-vindas` e `#files`, soltos

### Arrumações manuais, depois do apply

Só se você quiser — cada uma preserva o ID porque é feita na interface:

1. Arrastar `#boas-vindas` para dentro de `PONTE DE COMANDO`
2. Arrastar `#files` para `Área Social` (ou para uma categoria `ARQUIVO`)
3. Renomear a categoria `Novidades` para `MINISTÉRIO DA VERDADE` — puro tema,
   e é o nome certo na ficção do jogo para o canal que distribui comunicados
4. Renomear `Zona de Combate¹`/`²` para `Hellpod Alfa` / `Hellpod Bravo`

**Depois de qualquer uma delas, rode `pnpm guild scan "Goodivers" --force`.**
Sem isso o `guild.yaml` fica descrevendo um servidor que não existe mais, e o
próximo `plan` vai querer "consertar" o que você acabou de arrumar.

---

## 5. Fase 2 — Cargos (yaml, reversível)

### Cargos novos

Todos cosméticos ou de notificação. Nenhum ganha permissão de moderação.

| Cargo | Cor | Para quê |
| --- | --- | --- |
| `📡 Ordens Superiores` | `#ffd700` | quem quer ser pingado quando cai uma Major Order. Mencionável |
| `📡 Esquadrão` | `#4aa8ff` | ping de LFG em `#recrutamento`. Mencionável |
| `Terminídeos` | `#f0a000` | facção preferida, puro cosmético |
| `Autômatos` | `#c0392b` | idem |
| `Iluminados` | `#8e44ad` | idem |

Os dois de ping substituem o `@everyone` para avisos: hoje **três cargos**
(`moderador`, `Super Cidadão` e `normal`) têm `MentionEveryone`, o que na
prática é ping geral liberado pra base inteira.

### Ajustes em cargos existentes

| Cargo | Hoje | Proposto | Por quê |
| --- | --- | --- | --- |
| `normal` | 16 permissões, com `MentionEveryone` | tirar `MentionEveryone` | é o cargo da base. Com ele, qualquer membro dá ping geral |
| `Super Cidadão` | 22 permissões, com `MentionEveryone` e `MoveMembers` | virar cosmético (cor + hoist), ou manter só `MoveMembers` | ele senta na posição 4, entre patentes. Se a ideia era ser recompensa de apoiador, não deveria mover gente entre salas |
| `moderador` | 35 permissões | manter | está correto para o papel |
| `admin` | 38 permissões | manter | `Administrator` já cobre tudo; encolher a lista seria mudança real de bits, não cosmética |
| 10 patentes | nome + cor + hoist | manter | a ordem já bate com a escada do jogo. Não vale gastar `--reorder` |

> As patentes hoje não são atribuídas por nada. A Fase 3 resolve isso.

### Renomes temáticos — manual, se quiser

Renomear cargo pelo yaml cria um cargo novo **vazio** e deixa o antigo com os
membros dentro. Pela interface do Discord, renomear preserva o cargo e quem
está nele. Então:

- `moderador` → `Oficial da Democracia`
- `admin` → `Alto Comando`
- `normal` → `Helldiver`
- `Bots` → `Unidades Automatizadas SEAF`

Depois: `pnpm guild scan "Goodivers" --force`.

---

## 6. Fase 3 — Recursos do bot (dividido)

A config de módulo **não** tem rota na API: `apps/bot/src/api/routes/config.ts`
só expõe `POST /invalidate`, que limpa cache. Quem escreve é o painel, direto
na tabela `module_configs`, e só depois chama o invalidate. Algumas coisas,
porém, têm endpoint próprio — e essas eu faço daqui.

### 6.1 Eu faço, pela API (só preciso do token, que já tenho)

| O quê | Rota |
| --- | --- |
| Cadastrar o canal do YouTube do Goodivers | `POST /guilds/:id/social` (+ `/resolve` para validar a URL, `/test` para um anúncio de exemplo) |
| Subir emojis e stickers temáticos de HD2 | `POST /guilds/:id/expressions/emojis` e `/stickers` |
| Nome e avatar do bot neste servidor | `PATCH /guilds/:id/bot-profile` |
| Publicar os painéis de cargo depois de montados | `POST /guilds/:id/reaction-roles/:panelId/publish` |

O módulo de redes sociais **não anuncia nada na primeira passada** — ele marca
o que já está no feed e avisa do próximo em diante. Cadastrar hoje não vai
despejar os últimos 15 vídeos de uma vez.

### 6.2 Você faz, no painel (poucas telas, e fica na auditoria com seu nome)

Escrever direto na tabela pularia a validação Zod da página **e** a linha de
auditoria (`withAudit` em `apps/web/lib/module-config.ts:209`). Por isso estas
ficam com você — são quatro telas.

| Módulo | Onde | O quê configurar |
| --- | --- | --- |
| **Boas-vindas** | `#boas-vindas` | template pronto abaixo |
| **Autorole** | — | cargo `normal` na entrada. Se quiser barrar raid, usar a verificação por botão em `#protocolo` em vez do cargo automático |
| **Reaction roles** | `#cargos` | dois painéis — conteúdo pronto abaixo. Monte no painel; eu publico pela API se preferir |
| **Logs** | canal novo só-staff | entrada, saída, edição, exclusão, punição |
| **Automod** | — | convite, link, flood. **Escolha entre este e o AutoMod nativo do Discord, não os dois** |

**Template de boas-vindas, pronto para colar:**

```
Helldiver {user} acaba de desembarcar no Super Destroyer.
Somos {count} lutando pela Democracia Administrada em {server}.

Leia o #protocolo e pegue sua facção em #cargos. A Liberdade não espera.
```

**Painel de reação 1 — Facção** (título: `ESCOLHA SEU INIMIGO`)

| Opção | Cargo |
| --- | --- |
| 🐛 Terminídeos | `Terminídeos` |
| 🤖 Autômatos | `Autômatos` |
| 👁 Iluminados | `Iluminados` |

**Painel de reação 2 — Avisos** (título: `TRANSMISSÕES`)

| Opção | Cargo |
| --- | --- |
| 📡 Ordens Superiores | `📡 Ordens Superiores` |
| 🎮 Procurando esquadrão | `📡 Esquadrão` |

---

## 7. Ordem de execução

```
1.  Você confirma a zona intocável (§1)          ← trava de segurança
2.  MANUAL: nível de verificação → Médio
3.  Eu edito o guild.yaml (Fases 1 e 2)
4.  pnpm guild plan --server goodivers            ← eu te mostro a saída
5.  Você aprova
6.  pnpm guild apply --server goodivers           ← só cria e edita
7.  MANUAL: ligar Modo Comunidade, apontando #protocolo como regras
8.  MANUAL: converter os 3 feeds para Canal de Anúncio
9.  Painel: módulos da Fase 3
10. MANUAL (opcional): renomes e arrastadas da §4/§5
11. pnpm guild scan "Goodivers" --force           ← rebate o retrato
```

O passo 6 roda **sem `--allow-delete`**. Com a flag ausente, o apply não
consegue apagar nem que eu erre o arquivo: o que existe no servidor e não está
no yaml é simplesmente ignorado.

## 8. Como desfazer

| Fase | Reversão |
| --- | --- |
| 1 e 2 (yaml) | os canais e cargos novos são apagáveis pelo Discord ou por um `apply --allow-delete` contra o yaml antigo. O `guild.yaml` de hoje está no git — `git checkout` nele é o botão de voltar |
| 0 (Comunidade) | desligável no Discord. Canal de anúncio volta a texto pela mesma tela |
| 3 (módulos) | cada módulo tem desligar no painel; despublicar um painel de reaction-roles remove a mensagem sem perder a config |
| Renomes manuais | renomear de volta. Nada se perde, porque o ID nunca mudou |

Nada neste plano apaga canal, apaga cargo ou toca em mensagem.
