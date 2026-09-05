# CoBot — Style Guide do painel (skin `retro`, temas `crimson` e `rose`)

**Origem:** portado de `GoodChat/.harness/styleguides/retro.md` + os tokens de
`palettes.css`/`themes.css` daquele projeto. Os hex, a fonte e a identidade dos
dois temas foram copiados **sem alteração**. O que mudou é só o vocabulário de
componentes: o GoodChat é um chat (balão, composer, tile de conversa); o CoBot é
um painel de administração (tabela, formulário, gráfico, estados de
loading/erro/vazio). §6 e §8 são a adaptação; §1–§5 são o original.

**Escopo:** o painel web (`apps/web`) inteiro — login, dashboard, páginas de
configuração, gestão de membros/casos, auditoria, modais e toasts. O bot não tem
UI; embeds do Discord seguem só a §9.

---

## 0. Regras de uso no painel (leia primeiro)

1. **Um skin, dois temas.** A skin é sempre `retro` (neobrutal). Não existe
   skin `terminal` no CoBot — nada de glow, CRT, dashed, prompt de shell.
2. **Tema padrão: `rose` (escuro).** Painel de moderação é usado à noite e por
   longos períodos; `crimson` (claro) é a alternativa. `prefers-color-scheme`
   decide na primeira visita; a escolha manual fica em `localStorage`
   (`cobot-theme`) e é aplicada em `<html data-theme="crimson|rose">` por um
   script inline no `<head>` **antes** da hidratação (sem flash).
3. **Alternância:** toggle na topbar (ícone sol/lua, `icon-btn`), atalho
   `Shift+T`. Componente `ThemeToggle` em `apps/web/components/theme-toggle.tsx`;
   provider `ThemeProvider` só para expor `theme`/`setTheme` — não usar
   `next-themes` (o script inline já resolve e o provider é trivial).
4. **Onde os tokens vivem:** `apps/web/app/globals.css` — bloco `:root` com
   `--palette-*` (hex, uma vez só), bloco `[data-theme='crimson']` e
   `[data-theme='rose']` mapeando os tokens semânticos (§2.3) e os aliases
   shadcn (§7). **Hex em nenhum outro arquivo.** Componente nunca hardcoda
   cor, radius, espessura ou sombra.
5. **shadcn/ui tematizado obrigatoriamente** (todos os que o painel usar):
   `button`, `input`, `textarea`, `select`, `switch`, `checkbox`,
   `radio-group`, `label`, `form`, `table`, `card`, `dialog`,
   `alert-dialog`, `sheet`, `dropdown-menu`, `command`, `popover`,
   `tooltip`, `tabs`, `badge`, `separator`, `skeleton`, `sonner` (toast),
   `pagination`, `breadcrumb`, `sidebar`, `scroll-area`, `calendar`,
   `slider`. Regra: `--radius: 0` global, borda `2px base-300`, sombra dura
   nos elevados. Componentes gerados pelo CLI são **editados** em
   `apps/web/components/ui/*` para casar com §6 (é o esperado do shadcn).
6. **Gráficos:** Recharts via shadcn `chart`. Cores das séries só de tokens
   (§6.7). Sem gradiente, sem sombra suave, sem animação de entrada com
   overshoot.
7. **Quem for implementar uma tela nova** lê §6 (componente por componente)
   e §8 (estados). Se um componente não estiver listado, deriva do mais
   parecido e adiciona a entrada aqui.

---

## 1. Identidade

**Neobrutalismo.** Cantos 100% retos, molduras grossas, sombra dura deslocada
sem blur, tipografia display gorda e itálica, hover que **levanta** o elemento
como se fosse um cartão físico sendo pego.

A frase que resolve dúvida de implementação: _o retro preenche._ A cor vive no
**fill** (avatar accent sólido, badge preenchido, linha selecionada que inunda
de accent) e a borda é uma linha neutra de `base-300`.

**Padrão notável do tema escuro:** a cor da borda (`base-300`) é a cor _clara_
do texto. Borda forte e visível nos dois temas — nunca cinza sutil.

---

## 2. Cores

### 2.1 Paleta bruta (`--palette-*`, hex existe uma única vez)

Somente as famílias usadas pelos dois temas + status + overlay. Copiadas do
`palettes.css` do GoodChat.

| Token                      | Hex                | Papel                                              |
| -------------------------- | ------------------ | -------------------------------------------------- |
| `--palette-cream`          | `#f2efe7`          | fundo de página (claro) / texto e borda (escuro)   |
| `--palette-white`          | `#ffffff`          | superfície elevada (claro) / conteúdo sobre accent |
| `--palette-ink`            | `#1a0a0a`          | texto e borda (claro)                              |
| `--palette-noir`           | `#121212`          | fundo de página (escuro)                           |
| `--palette-noir-raised`    | `#1a1a1a`          | superfície elevada (escuro)                        |
| `--palette-near-black`     | `#0d0d0d`          | texto sobre status suavizado (escuro)              |
| `--palette-crimson`        | `#dc143c`          | accent — tema claro                                |
| `--palette-rose`           | `#e8729a`          | accent — tema escuro                               |
| `--palette-info`           | `#2563eb`          | status cheio (claro)                               |
| `--palette-success`        | `#16a34a`          | status cheio (claro)                               |
| `--palette-warning`        | `#d97706`          | status cheio (claro)                               |
| `--palette-error`          | `#dc2626`          | status cheio (claro)                               |
| `--palette-info-soft`      | `#60a5fa`          | status suavizado (escuro)                          |
| `--palette-success-soft`   | `#4ade80`          | status suavizado (escuro)                          |
| `--palette-warning-soft`   | `#fbbf24`          | status suavizado (escuro)                          |
| `--palette-error-soft`     | `#f87171`          | status suavizado (escuro)                          |
| `--palette-scanline-light` | `rgba(0,0,0,0.05)` | scanline (claro)                                   |
| `--palette-scanline-dark`  | `rgba(0,0,0,0.2)`  | scanline (escuro)                                  |

### 2.2 Os dois temas (tokens semânticos)

Copiados de `themes.css` (`goodchat-crimson` → `crimson`, `goodchat-rose` →
`rose`). Nomes daisyUI mantidos como nomes semânticos internos; o mapeamento
para shadcn está em §7.

| Token                                | `crimson` (claro, `color-scheme: light`) | `rose` (escuro, `color-scheme: dark`)  |
| ------------------------------------ | ---------------------------------------- | -------------------------------------- |
| `base-100` (fundo de página)         | cream                                    | noir                                   |
| `base-200` (superfície elevada)      | white                                    | noir-raised                            |
| `base-300` (toda moldura)            | ink                                      | cream                                  |
| `base-content` (texto)               | ink                                      | cream                                  |
| `primary` / `accent`                 | crimson                                  | rose                                   |
| `primary-content` / `accent-content` | white                                    | white                                  |
| `secondary`                          | ink                                      | cream                                  |
| `secondary-content`                  | white                                    | noir                                   |
| `neutral` / `neutral-content`        | ink / white                              | cream / noir                           |
| `info` / `-content`                  | info / white                             | info-soft / near-black                 |
| `success` / `-content`               | success / white                          | success-soft / near-black              |
| `warning` / `-content`               | warning / white                          | warning-soft / near-black              |
| `error` / `-content`                 | error / white                            | error-soft / near-black                |
| `--shadow` (cor da sombra dura)      | ink                                      | **rose** (a sombra é accent no escuro) |
| `--scanline-color`                   | scanline-light                           | scanline-dark                          |

Geometria igual nos dois: `--radius-*: 0rem`, `--border: 2px`, `--depth: 0`,
`--noise: 0`.

### 2.3 Onde cada token vai (uso)

| Papel                                                                                | Token                                           |
| ------------------------------------------------------------------------------------ | ----------------------------------------------- |
| Fundo de página                                                                      | `base-100`                                      |
| Superfície elevada (card, painel, linha de tabela expandida, input, popover, dialog) | `base-200`                                      |
| Toda moldura                                                                         | `base-300` — a moldura é neutra, nunca accent   |
| Sombra dura                                                                          | `--shadow` (declarado por tema)                 |
| Ênfase / estado ativo / item de nav selecionado / avatar / badge primário            | `accent` + `accent-content`                     |
| Status (badge de caso, toast, banner)                                                | `info`/`success`/`warning`/`error` + `-content` |
| Micro-texto decorativo                                                               | `base-content` com `opacity-40`–`70`            |

Semântica de moderação (fixa, os dois temas): ban/softban → `error`,
kick → `warning`, timeout → `warning`, warn → `info`, unban/unlock →
`success`, automod → `accent`, nota interna → `neutral`.

---

## 3. Tipografia

**Uma família para tudo: JetBrains Mono** (`@fontsource/jetbrains-mono`, pesos
400/500/700/800 + itálicos). `--font-sans` e `--font-mono` apontam para ela —
não existe sans separada.

| Uso                                  | Tratamento                                                                                                                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Título de tela (`screen-title`)      | `text-3xl`→`4xl` (login: `5xl`→`6xl`), `font-black`, `uppercase`, **`italic`**, `tracking-tighter`; no login com `underline decoration-accent decoration-4 underline-offset-4` |
| Kicker (`screen-kicker`)             | `font-mono text-xs font-bold uppercase tracking-widest text-accent`, precedido do `>` literal (`.sigil`)                                                                       |
| Label de seção (`section-label`)     | igual ao kicker, ou `text-[10px] tracking-[0.2em]` na variante compacta; também com `>`                                                                                        |
| Cabeçalho de tabela (`th`)           | `text-[10px] font-black uppercase tracking-[0.2em] opacity-60`                                                                                                                 |
| Label de formulário                  | `text-xs font-bold uppercase tracking-widest`                                                                                                                                  |
| Corpo / célula                       | `text-sm`/`text-base`, `leading-relaxed`; números tabulares (`tabular-nums`) em colunas numéricas                                                                              |
| Valor de stat (`stat-value`)         | `text-3xl`→`4xl font-black tracking-tighter tabular-nums`                                                                                                                      |
| Micro-texto (hora, id, status, meta) | `font-mono text-[10px] uppercase tracking-[0.2em]` + `opacity-40`–`60`                                                                                                         |
| IDs do Discord (snowflake)           | micro-texto, `select-all`, nunca truncado                                                                                                                                      |

Padrões-chave: **caixa alta em tudo que não é corpo**, `tracking-tighter` nos
títulos grandes e `tracking-widest`/`[0.2em]` nos micro-labels, itálico como
recurso de display, `font-black`/`font-bold` dominantes.

> `font-black` é 900 e a face mais pesada carregada é 800 — o browser resolve
> para 800. Comportamento herdado e **aprovado**; não "corrigir".

---

## 4. Motifs

Numerados: o código referencia por número (`styleguide §4.3`).

1. **Sombra dura deslocada** — a assinatura nº 1. `--frame-shadow: 6px 6px 0 0
var(--shadow)`, `--frame-shadow-sm: 3px 3px 0 0 var(--shadow)`. Sem blur, sem
   spread. Consumidas por `retro-shadow` / `retro-shadow-sm`.
2. **Moldura grossa reta** — `--frame-border: 2px`, cor `base-300`, via
   `retro-border`.
3. **Zero border-radius** — em tudo, inclusive avatar, ponto de presença,
   switch, checkbox, badge, toast, tooltip. Exceção deliberada: nenhuma.
4. **Scanline discreta** — `terminal-scanline`: gradiente repetido de 1px a
   cada 4px, `opacity: 0.3`, `position: fixed`, `pointer-events: none`. É
   textura, não tela.
5. **Caret piscando** — `terminal-cursor` = `_` com `blink 1s step-end
infinite`. Usado em "salvando…", "carregando…" e em placeholders vivos, no
   lugar de spinner circular.
6. **Micro-texto de máquina** — prefixo `>` nos kickers e labels, valores em
   colchetes (`[sem motivo]`, `[bot]`, `[expirado]`), estados em caixa alta.
7. **WindowDots** — três quadrados-ou-círculos de janela: `bg-accent`,
   `bg-base-300`, `bg-base-300`. **No CoBot são quadrados** (§4.3 vale
   para tudo; o GoodChat usava círculo por herança e isso não é portado).
8. **Barra de título de painel** (`window-bar`) — linha inferior de 2px em
   `base-300` sobre `base-100`, nome do "arquivo" em micro-texto bold
   `opacity-40` **em caixa alta** (`AUTOMOD.CFG`, `CASOS.LOG`,
   `MEMBROS.DB`) e os WindowDots à direita. Todo card de configuração tem uma.
9. **Levantar no hover** — `hover:-translate-y-1` + sombra `sm`→padrão, e
   `active:translate-y-0`. `transition-all duration-300`. Só em elementos
   **clicáveis** (tile, botão, linha-link, card-link). Linha de tabela comum
   não levanta — faz fill (§6.3).
10. **Seleção temática** — `::selection` em accent/accent-content.
11. **Botão como CTA grande** — 3.25rem (md: 3.75rem), peso 900, caixa alta
    (§6.1). Em tabelas e barras usa-se o `icon-btn` compacto.
12. **Foco visível** — `outline: 2px solid var(--color-accent)`,
    `outline-offset: 2px`, sólido.
13. **`prefers-reduced-motion`** — animações congeladas, scanline escondida.

**Não existem** (não inventar): glow de fósforo, vignette/curvatura de CRT, dot
grid, dithering, glitch, fonte pixel, borda pixel-stepped, prompt de shell,
gradientes, sombra suave, border-radius, spinner circular, skeleton com
shimmer.

### Motion

- Entrada: `animate-enter` — fade + `translateY(8px)` → 0 em 200ms,
  `cubic-bezier(0.33, 1, 0.68, 1)`, **zero overshoot**. Sem spring, sem
  bounce (regra de time).
- Interação: `hover:-translate-y-1` + crescimento de sombra, `duration-300`;
  `active` volta ao lugar.
- Ambiente: caret piscando (1s) e scanline estática. Nada mais se mexe
  sozinho. Gráficos: `isAnimationActive={false}` ou animação de 200ms
  ease-out, nunca o default elástico do Recharts.
- Troca de tema: `background-color`/`color` com `transition 0.3s ease` no
  `body`.

---

## 5. Espaçamento e geometria

| Token                                                                       | Valor                         |
| --------------------------------------------------------------------------- | ----------------------------- |
| `--radius-selector` / `--radius-field` / `--radius-box` / shadcn `--radius` | `0rem`                        |
| `--border` (controles)                                                      | `2px`                         |
| `--frame-border`                                                            | `2px`                         |
| `--frame-shadow` / `--frame-shadow-sm`                                      | `6px 6px 0 0` / `3px 3px 0 0` |
| `--focus-ring-style` / `--focus-ring-offset`                                | `solid` / `2px`               |
| `--depth` / `--noise`                                                       | `0`                           |

Convenções (escala Tailwind padrão): card `p-4`→`p-6` com `gap-4`; tile `p-4`
e `gap-3`; barra de título `px-4 py-3`; botão de ícone `px-3 py-2`; célula de
tabela `px-4 py-3`; formulário `gap-6` entre campos e `gap-2` label→controle;
página `screen-pad` (1rem, `sm:` 2rem, com `safe-area-inset`); sidebar 16rem
(`lg:` fixa, abaixo vira `sheet`).

---

## 6. Componentes do painel

Toda classe abaixo é uma **hook class** aplicada pelo componente; o CSS do tema
faz o resto. Regra de ouro herdada: **nenhum componente ramifica por tema** —
não existe `if (theme === 'rose')` em React.

### 6.1 Botões

- **`btn-goodchat`** (CTA, fill accent) e **`btn-goodchat-outline`**
  (transparente, texto `base-content`): borda `base-300`, `--btn-p: 1rem`
  (md: `2rem`), altura `3.25rem`→`3.75rem`, fonte `0.875rem`→`1rem`, peso
  900, caixa alta, `letter-spacing: 0.05em`. Uso: submit de formulário,
  ação primária da página, login.
- **`btn-goodchat-danger`** (novo, painel): igual ao CTA com fill `error` /
  texto `error-content`. Uso: ban, purge, reset de config — sempre atrás de
  `alert-dialog`.
- **`icon-btn`** (compacto): `retro-border bg-base-200`, `text-[10px]
font-black uppercase tracking-widest`, `px-3 py-2`, hover accent + levanta,
  `disabled:opacity-40`. Uso: barra de ações de tabela, topbar, toggles.
- Estado _loading_: texto vira `SALVANDO_` com `terminal-cursor`; botão
  `disabled`. Nunca spinner.
- shadcn `Button`: `variant` mapeado → `default`=`btn-goodchat`,
  `outline`=`btn-goodchat-outline`, `destructive`=`btn-goodchat-danger`,
  `ghost`/`icon`=`icon-btn`. `size` ignorado exceto `icon`.

### 6.2 Painel / Card (`panel`)

`retro-border bg-base-200 retro-shadow`, barra de título (§4.8) obrigatória em
cards de configuração e opcional em cards de stat, `panel-body` com `p-4`→`p-6
gap-4`. shadcn `Card` recebe `panel`; `CardHeader` vira `window-bar`;
`CardTitle` é micro-texto caixa alta (não título grande — o título grande é o
`screen-title` da página).

### 6.3 Tabela (`data-table`)

- Wrapper `retro-border bg-base-200 retro-shadow overflow-x-auto`.
- `thead`: fundo `base-100`, linha inferior `2px base-300`, `th` em micro-texto
  §3. Coluna ordenável mostra `▲`/`▼` literal ao lado do label.
- `tbody tr`: linha separada por `1px base-300` com `opacity-30`; hover faz
  **fill** `color-mix(base-content 8%)` (não levanta); linha selecionada
  (checkbox) faz fill `accent` + `accent-content`; linha clicável (leva à
  página do membro/caso) tem `cursor-pointer` e o mesmo fill no hover.
- Célula de ID: micro-texto `select-all`. Célula de usuário: `avatar-sq`
  24px + nome bold + tag `opacity-60`. Célula de ação: `tag` (§6.6). Célula
  de data: `<time>` em micro-texto com tooltip do ISO completo.
- Barra de ferramentas acima: `input` de busca à esquerda, filtros (`select`/
  `popover` com `command`) no meio, `icon-btn`s à direita. Barra de seleção
  em massa aparece **no lugar** da barra de ferramentas quando há seleção,
  com fill `accent`.
- Paginação abaixo: `icon-btn`s `< ANTERIOR` / `PRÓXIMA >` + micro-texto
  `PÁGINA 3/12 · 240 REGISTROS`.
- Densidade única. Não existe "compact mode".
- Implementação: TanStack Table por trás do shadcn `table`.

### 6.4 Formulários

- Campo (`input`, `textarea`, `select` trigger): `retro-border bg-base-200`,
  radius 0, `h-11`, `px-3`, fonte `text-sm`; foco = anel §4.12; erro = borda
  `error` + mensagem em micro-texto `text-error` abaixo com prefixo `!`.
- Label acima (§3), `required` marcado com `*` em `text-accent`. Descrição
  ajuda em `text-xs opacity-60` abaixo do label, antes do campo.
- `switch`: trilho retangular 2.5rem×1.25rem `retro-border`, thumb quadrado
  `base-300` → `accent-content` sobre trilho `accent` quando ligado. Nunca
  pílula.
- `checkbox`/`radio`: quadrado 1.25rem `retro-border`; marcado = fill
  `accent` com `✓`/`■`. Radio é **quadrado** também (§4.3).
- `select`/`combobox`: trigger igual ao input com `▼` literal; lista em
  `popover` (§6.5).
- Seletor de canal / cargo / membro do Discord (`discord-picker`): `command`
  com busca, item mostra `#nome` ou `@cargo` com quadradinho na cor do cargo;
  múltiplo mostra os escolhidos como `tag`s removíveis dentro do campo.
- Editor de mensagem com variáveis (`template-editor`): `textarea` mono +
  barra de `icon-btn`s com as variáveis (`{user}`, `{server}`,
  `{memberCount}`) que inserem no cursor + preview ao lado renderizado como
  embed do Discord (§9).
- Duração (`duration-input`): input numérico + `select` de unidade
  (min/h/d/sem) numa única moldura; atalhos `10m`, `1h`, `7d` como `tag`s.
- Rodapé de formulário: `btn-goodchat` "SALVAR" à direita, `btn-goodchat-
outline` "DESCARTAR" à esquerda, barra fixa no fundo (`sticky bottom-0
bg-base-100 border-t-2 border-base-300`) que só aparece quando o form está
  _dirty_. Salvar mostra toast (§6.8).
- Implementação: react-hook-form + zod resolver com os schemas de
  `packages/shared`.

### 6.5 Overlays

- **Dialog / AlertDialog / Sheet**: `dialog-box` = `retro-border bg-base-200
retro-shadow`, `window-bar` com título, overlay `bg-base-100/80` (sem blur).
  `AlertDialog` destrutivo tem WindowDots com o primeiro ponto em `error` e
  botão confirmar `btn-goodchat-danger`; o texto de confirmação exige o
  motivo quando a ação é de moderação.
- **Popover / DropdownMenu / Command**: `retro-border bg-base-200
retro-shadow-sm`, item `px-3 py-2 text-sm`, item ativo = fill `accent`.
- **Tooltip**: `retro-border bg-base-300 text-base-100` (invertido), micro-
  texto, sem seta, `retro-shadow-sm`.
- Entrada de todos: `animate-enter`. Saída: fade 150ms.

### 6.6 Badges e tags (`tag`)

`retro-border` 2px, `px-2 py-0.5`, micro-texto bold caixa alta. Variantes:
`tag-accent`, `tag-error`, `tag-warning`, `tag-info`, `tag-success`,
`tag-muted` (`base-200` + `opacity-70`). Mapeamento de ação de moderação em
§2.3. shadcn `Badge` recebe `tag` + variante; `variant="default"` = `tag-accent`.

### 6.7 Stats e gráficos

- **`stat-tile`**: `panel` com `stat-label` (micro-texto `>` + nome) em cima,
  `stat-value` (§3) grande, e `stat-delta` (micro-texto, `text-success`/
  `text-error` com `▲`/`▼` literal e `%`). Sparkline opcional de 1 linha
  `accent` sem eixo, 40px de altura.
- **Gráficos (Recharts via shadcn `chart`)**:
  - Fundo transparente sobre `panel`. Grid: só linhas horizontais, `1px
base-300` com `opacity-20`, sem dash.
  - Eixos: micro-texto `opacity-60`, sem linha de eixo, sem tick line.
  - Série única: `accent`. Multi-série (máx. 5, ordem fixa): `accent`,
    `info`, `success`, `warning`, `error`. Comparação "atual vs período
    anterior": atual `accent` sólido, anterior `base-content` com
    `opacity-30`.
  - Linha: `strokeWidth 2`, sem `dot`, `type="linear"` (nunca `monotone` —
    curva suave contradiz a identidade). Área: fill `accent` `opacity-15`,
    sem gradiente. Barra: fill sólido, `radius 0`, gap 20%.
  - Tooltip: mesma regra de §6.5 (moldura, sombra dura, micro-texto).
  - Legenda: `tag`s clicáveis que ligam/desligam série.
  - Sem animação de entrada (ou 200ms ease-out).
- **Heatmap de atividade (hora × dia da semana)**: grade de quadrados
  `retro-border` 1px, fill `accent` com opacidade em 5 degraus (0/25/50/75/
  100%). Tooltip mostra `SEG 21H · 143 MSGS`.
- **Barra de uso (`usage-track`/`usage-fill`)**: trilho `retro-border
bg-base-100` h-3, fill sólido `accent`, sem radius. Para cotas
  (armazenamento, rate limit).

### 6.8 Feedback

- **Toast (sonner)**: `retro-border bg-base-200 retro-shadow`, canto
  inferior direito, WindowDots com o primeiro ponto na cor do status,
  título em micro-texto caixa alta (`SALVO`, `ERRO`, `AVISO`), corpo
  `text-sm`, botão de ação como `icon-btn`. Sem ícone colorido redondo.
- **Banner de página** (`alert`): `retro-border` com borda `2px` na cor do
  status e fill `base-200`, prefixo `!` no título. Uso: "bot offline",
  "intents não habilitadas", "canal configurado foi deletado".
- **Confirmação inline** de ação destrutiva pequena (remover uma regra):
  o botão vira `CONFIRMAR?` em `error` por 3s e volta.

### 6.9 Navegação e layout

- **Sidebar** (`shadcn sidebar`): `bg-base-100 border-r-2 border-base-300`,
  logo/nome do servidor no topo em `screen-kicker` + `screen-title` pequeno,
  grupos com `section-label` (`> MODERAÇÃO`, `> COMUNIDADE`, `> SERVIDOR`),
  item = `px-3 py-2 text-sm font-bold uppercase tracking-wide`, ativo = fill
  `accent` + `accent-content` + sombra `sm`, hover = fill 8%. Abaixo de `lg`
  vira `sheet` com o mesmo conteúdo.
- **Topbar**: `border-b-2 border-base-300 bg-base-100`, `breadcrumb` em
  micro-texto à esquerda, à direita `ThemeToggle`, status do bot
  (`presence-dot` + `ONLINE`/`OFFLINE` micro-texto) e avatar do admin
  (`avatar-sq` 32px) com `dropdown-menu` (sair).
- **Cabeçalho de página**: `screen-kicker` (`> AUTOMOD`) + `screen-title`
  (`REGRAS`) + `screen-meta` (micro-texto, ex.: `12 REGRAS · 3 ATIVAS`) e
  ações primárias à direita.
- **Avatar** (`avatar-sq`): quadrado `retro-border`, foto ou fill `accent`
  com inicial `accent-content font-black uppercase`.
- **Presença** (`presence-dot`): quadrado 12px com anel 2px `base-200`;
  `success` quando online, `error` offline, `warning` reconectando.

---

## 7. Mapeamento shadcn ↔ tokens (`globals.css`)

shadcn lê variáveis próprias. Elas são **aliases**, nunca cores novas:

| shadcn                                       | token semântico                                                                     |
| -------------------------------------------- | ----------------------------------------------------------------------------------- |
| `--background` / `--foreground`              | `base-100` / `base-content`                                                         |
| `--card` / `--card-foreground`               | `base-200` / `base-content`                                                         |
| `--popover` / `--popover-foreground`         | `base-200` / `base-content`                                                         |
| `--primary` / `--primary-foreground`         | `accent` / `accent-content`                                                         |
| `--secondary` / `--secondary-foreground`     | `secondary` / `secondary-content`                                                   |
| `--muted`                                    | `base-200`; `--muted-foreground` = `base-content` com `opacity` via `color-mix 60%` |
| `--accent` / `--accent-foreground`           | `accent` / `accent-content`                                                         |
| `--destructive` / `--destructive-foreground` | `error` / `error-content`                                                           |
| `--border` / `--input` / `--ring`            | `base-300` / `base-300` / `accent`                                                  |
| `--chart-1..5`                               | `accent`, `info`, `success`, `warning`, `error`                                     |
| `--sidebar*`                                 | mesmos de background/foreground/primary/border                                      |
| `--radius`                                   | `0rem`                                                                              |

Ordem no `globals.css`: `@import "tailwindcss"` → `:root { --palette-* }` →
`[data-theme='crimson']` (também em `:root` como default de fallback) →
`[data-theme='rose']` → `@theme inline` com os aliases shadcn e fontes →
utilities (`retro-border`, `retro-shadow(-sm)`, `terminal-cursor`,
`terminal-scanline`, `animate-enter`, `btn-goodchat*`, `screen-pad`) → base.
Regras de tema são **unlayered** de propósito; nunca mirar numa utility que o
componente combina com variante — mirar na hook class.

---

## 8. Estados (loading / erro / vazio / offline)

- **Loading de página**: `skeleton` = blocos `retro-border bg-base-200` com
  padrão de listras diagonais estáticas (`repeating-linear-gradient` 45°,
  `base-300` `opacity-10`), **sem shimmer**; micro-texto `CARREGANDO_` com
  caret no cabeçalho. Tabela mostra 5 linhas skeleton na altura real.
- **Loading de ação**: botão em `SALVANDO_` (§6.1); tabela em refetch mantém
  dados e reduz `opacity-60` no `tbody`.
- **Vazio**: dentro do `panel`, centralizado, `screen-kicker` `> NADA AQUI`,
  linha `text-sm opacity-70` explicando, e um CTA (`btn-goodchat-outline`)
  quando houver ação óbvia (`CRIAR REGRA`). Sem ilustração.
- **Erro de carregamento**: banner `alert` `error` no lugar do conteúdo com
  a mensagem, o `requestId` em micro-texto `select-all` e `icon-btn`
  `TENTAR NOVAMENTE`.
- **Erro de formulário**: campo (§6.4) + toast `ERRO` se o servidor recusar.
- **Bot offline** (API interna não responde): banner `warning` fixo abaixo
  da topbar em todas as páginas; ações que dependem do bot ficam `disabled`
  com tooltip `BOT OFFLINE`.
- **Sem permissão**: página inteira com `screen-title` `ACESSO NEGADO`,
  explicação e botão `SAIR`.
- **Sessão expirada**: redirect para login com `?reason=expired` que vira
  banner `info`.

---

## 9. Embeds do Discord (bot)

Não é UI web, mas é a única "tela" do bot e deve parecer da mesma família:

- Cor da barra lateral do embed: `crimson` `#dc143c` para ações do bot em
  geral; status de moderação usa os hex de status **cheios** (§2.1):
  ban `#dc2626`, kick/timeout `#d97706`, warn `#2563eb`, unban `#16a34a`.
- Título em caixa alta com prefixo `>`; campos curtos; IDs sempre em
  `inline code`; rodapé `CASO #123 · MOD: nome`. Sem emoji decorativo, um
  emoji de status no máximo.
- Botões de componente: label caixa alta; destrutivo = `Danger`, primário =
  `Primary`, resto `Secondary`.

---

## 10. Origem e decisões

Portado de `GoodChat/.harness/styleguides/retro.md` (skin `retro` do
Portfolio → GoodChat → CoBot). Decisões mantidas: par cream/crimson ·
noir/rose; `font-black` sobre face 800; scanline na força base; foco sólido
2px; zero radius sem exceção.

Decisões novas do CoBot:

1. **Sem daisyUI** — a stack é shadcn; os nomes daisyUI (`base-100`, `accent`)
   ficam como nomes semânticos internos e são mapeados em §7.
2. **Só dois temas** (`crimson`, `rose`) e uma skin. As outras oito paletas do
   GoodChat não são portadas; ponto de extensão: adicionar um bloco
   `[data-theme='x']` e a entrada no `ThemeToggle`.
3. **Padrão escuro** (`rose`).
4. WindowDots **quadrados** (§4.7).
5. Linha de tabela não levanta; faz fill (§6.3). "Levantar" é só para o que
   é um cartão.
6. Gráficos com `type="linear"`, sem gradiente, sem animação (§6.7).
