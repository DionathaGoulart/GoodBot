'use client';

import { Toaster as Sonner, type ToasterProps } from 'sonner';

import { useTheme } from '@/components/theme/theme-provider';

/**
 * §6.8 — toast com moldura, sombra dura e título em micro-texto. O tema vem do
 * nosso `ThemeProvider` (o styleguide §0.3 proíbe `next-themes`).
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme } = useTheme();

  return (
    <Sonner
      theme={theme === 'crimson' ? 'light' : 'dark'}
      position="bottom-right"
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--base-200)',
          '--normal-text': 'var(--base-content)',
          '--normal-border': 'var(--base-300)',
          '--border-radius': '0',
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: 'panel !rounded-none',
          title: 'text-[10px] font-black uppercase tracking-[0.2em]',
          description: 'text-sm',
          actionButton: 'icon-btn',
          cancelButton: 'icon-btn',
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
