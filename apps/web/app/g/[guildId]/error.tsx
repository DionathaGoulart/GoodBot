'use client';

import { ErrorState } from '@/components/retro/states';
import { ScreenHeader } from '@/components/retro/screen-header';

/**
 * §8 — erro de carregamento: banner no lugar do conteúdo, `digest` em
 * micro-texto para o suporte casar com o log do servidor, e `reset()` no
 * botão (o `try/catch` do React, não um F5, que perderia o período da URL).
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <>
      <ScreenHeader kicker="PAINEL" title="DASHBOARD" />
      <ErrorState
        title="FALHA AO CARREGAR"
        description="Não foi possível ler as estatísticas. O banco ou a API do bot pode estar fora do ar."
        requestId={error.digest}
        action={
          <button type="button" className="icon-btn self-start" onClick={reset}>
            TENTAR NOVAMENTE
          </button>
        }
      />
    </>
  );
}
