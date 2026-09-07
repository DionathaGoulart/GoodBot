import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * §2.4 — os pares de cor dos dois temas contra WCAG AA. O teste lê o
 * `globals.css` de verdade: mexer num `--palette-*` sem refazer a conta quebra
 * aqui, que é o único lugar onde a régua está escrita.
 */
const CSS = readFileSync(fileURLToPath(new URL('./globals.css', import.meta.url)), 'utf8');

const PALETTE = new Map(
  [...CSS.matchAll(/--palette-([\w-]+):\s*(#[0-9a-f]{6})/g)].map(([, name, hex]) => [name, hex]),
);

/** Um tema resolvido: `--token` → hex, só para os que apontam para a paleta. */
function themeOf(selector: string): (token: string) => string {
  const block = CSS.slice(CSS.indexOf(selector));
  const body = block.slice(block.indexOf('{') + 1, block.indexOf('\n}'));
  const tokens = new Map(
    [...body.matchAll(/^\s*--([\w-]+):\s*var\(--palette-([\w-]+)\)/gm)].map(
      ([, token, palette]) => [token, PALETTE.get(palette ?? '')],
    ),
  );
  return (token) => {
    const hex = tokens.get(token);
    // Token que sumiu do tema é falha de teste, não `undefined` silencioso.
    if (!hex) throw new Error(`${selector}: --${token} não resolve para um --palette-*`);
    return hex;
  };
}

function channels(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const one = luminance(a);
  const two = luminance(b);
  const light = Math.max(one, two);
  const dark = Math.min(one, two);
  return (light + 0.05) / (dark + 0.05);
}

/** `color-mix(… N%, transparent)` sobre um fundo opaco é a média ponderada. */
function over(fg: string, bg: string, alpha: number): string {
  const back = channels(bg);
  const front = channels(fg);
  const blend = (index: 0 | 1 | 2) =>
    Math.round(front[index] * alpha + back[index] * (1 - alpha))
      .toString(16)
      .padStart(2, '0');
  return `#${blend(0)}${blend(1)}${blend(2)}`;
}

/** O `--muted-text` dos dois temas é `base-content` a 60% (§2.4). */
const MUTED_ALPHA = 0.6;

const THEMES: [string, (token: string) => string][] = [
  ['crimson', themeOf(":root,\n[data-theme='crimson'] {")],
  ['rose', themeOf("[data-theme='rose'] {")],
];

describe.each(THEMES)('tema %s', (_name, t) => {
  // 4.5:1 — texto. O micro-texto do §3 é 10px, então entra nesta régua e não
  // na de texto grande.
  const text: [string, string, string][] = [
    ['texto', t('base-content'), t('base-100')],
    ['texto sobre superfície', t('base-content'), t('base-200')],
    ['apagado', over(t('base-content'), t('base-100'), MUTED_ALPHA), t('base-100')],
    [
      'apagado sobre superfície',
      over(t('base-content'), t('base-200'), MUTED_ALPHA),
      t('base-200'),
    ],
    ['accent como texto', t('accent-text'), t('base-100')],
    ['accent como texto sobre superfície', t('accent-text'), t('base-200')],
    ['conteúdo sobre fill accent', t('accent-content'), t('accent')],
    ['conteúdo sobre fill info', t('info-content'), t('info')],
    ['conteúdo sobre fill success', t('success-content'), t('success')],
    ['conteúdo sobre fill warning', t('warning-content'), t('warning')],
    ['conteúdo sobre fill error', t('error-content'), t('error')],
    ['info como texto', t('info-text'), t('base-200')],
    ['success como texto', t('success-text'), t('base-200')],
    ['warning como texto', t('warning-text'), t('base-200')],
    ['error como texto', t('error-text'), t('base-200')],
  ];

  it.each(text)('%s passa AA (4.5:1)', (_label, fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  // 3:1 — elemento de interface. A moldura é a que importa: é o que separa um
  // painel do fundo.
  const ui: [string, string, string][] = [
    ['moldura sobre página', t('base-300'), t('base-100')],
    ['moldura sobre superfície', t('base-300'), t('base-200')],
  ];

  it.each(ui)('%s passa AA de interface (3:1)', (_label, fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(3);
  });
});
