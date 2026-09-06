'use client';

import { MoonIcon, SunIcon } from 'lucide-react';

import { useTheme } from './theme-provider';

/** §6.9 — `icon-btn` na topbar; o atalho Shift+T faz a mesma coisa. */
export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'rose';

  return (
    <button
      type="button"
      className="icon-btn"
      onClick={toggleTheme}
      aria-label={`Mudar para o tema ${isDark ? 'claro' : 'escuro'} (Shift+T)`}
      title="Shift+T"
    >
      {isDark ? <SunIcon className="size-3.5" /> : <MoonIcon className="size-3.5" />}
      <span className="hidden sm:inline">{isDark ? 'ROSE' : 'CRIMSON'}</span>
    </button>
  );
}
