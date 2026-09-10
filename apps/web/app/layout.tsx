import { headers } from 'next/headers';

import { ThemeProvider } from '@/components/theme/theme-provider';
import { ThemeScript } from '@/components/theme/theme-script';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';

import './globals.css';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Goodbot',
  description: 'Painel de moderação e configuração do Goodbot',
};

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  // O nonce vem do `middleware.ts`, que monta a CSP desta resposta.
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    // `suppressHydrationWarning`: o script inline escreve `data-theme` antes da
    // hidratação, então o servidor não tem como acertar o atributo.
    <html lang="pt-BR" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <ThemeScript nonce={nonce} />
      </head>
      <body className="flex min-h-full flex-col">
        <ThemeProvider>
          <TooltipProvider>
            {children}
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
        {/* §4.4 — textura, sempre por cima e nunca clicável. */}
        <div className="terminal-scanline" aria-hidden />
      </body>
    </html>
  );
}
