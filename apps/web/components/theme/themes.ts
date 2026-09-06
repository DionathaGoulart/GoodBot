/** Os dois temas do styleguide §0.1. `rose` (escuro) é o padrão do painel. */
export const THEMES = ['crimson', 'rose'] as const;
export type Theme = (typeof THEMES)[number];

export const DEFAULT_THEME: Theme = 'rose';
/** Chave no `localStorage`; o script inline do `<head>` lê a mesma. */
export const THEME_STORAGE_KEY = 'cobot-theme';

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}
