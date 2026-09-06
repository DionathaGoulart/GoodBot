'use client';

import * as React from 'react';

import { DEFAULT_THEME, THEME_STORAGE_KEY, isTheme, type Theme } from './themes';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

// O tema de verdade é o `data-theme` do `<html>`, escrito pelo script inline
// antes da hidratação. Tratamos o DOM como store externo: assim o React lê o
// valor já aplicado sem `useState` + efeito (que renderiza duas vezes).
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function readTheme(): Theme {
  const applied = document.documentElement.dataset.theme;
  return isTheme(applied) ? applied : DEFAULT_THEME;
}

function writeTheme(next: Theme) {
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // Modo privado / storage bloqueado: o tema vale só para esta sessão.
  }
  for (const listener of listeners) listener();
}

/**
 * Provider mínimo (styleguide §0.3): só expõe `theme`/`setTheme` e o atalho.
 * Nada de `next-themes`.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = React.useSyncExternalStore(subscribe, readTheme, () => DEFAULT_THEME);

  const setTheme = React.useCallback((next: Theme) => writeTheme(next), []);
  const toggleTheme = React.useCallback(
    () => writeTheme(readTheme() === 'crimson' ? 'rose' : 'crimson'),
    [],
  );

  // §0.3 — atalho global Shift+T.
  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key !== 'T') return;
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable) return;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      event.preventDefault();
      toggleTheme();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleTheme]);

  const value = React.useMemo(
    () => ({ theme, setTheme, toggleTheme }),
    [theme, setTheme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = React.useContext(ThemeContext);
  if (!context) throw new Error('useTheme precisa estar dentro de <ThemeProvider>.');
  return context;
}
