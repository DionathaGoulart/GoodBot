'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import type { ActionResult } from '@/lib/module-config';

/**
 * Rodar uma action do painel admin: trava os botões, mostra o toast e recarrega
 * a tela quando dá certo.
 *
 * Existe uma vez porque as três telas do admin fazem exatamente isto, e a única
 * coisa que muda entre elas é qual action chamar. `busy` guarda a **chave** da
 * operação em curso (e não um booleano) para o botão que foi clicado ser o
 * único a mostrar o rótulo de carregando — com um booleano a linha inteira
 * piscaria junto.
 */
export function useAdminAction<R extends ActionResult>() {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);

  const run = React.useCallback(
    async (
      key: string,
      action: (formData: FormData) => Promise<R>,
      fields: Record<string, string>,
    ): Promise<R | null> => {
      setBusy(key);
      try {
        const formData = new FormData();
        for (const [name, value] of Object.entries(fields)) formData.set(name, value);

        const result = await action(formData);
        if (!result.ok) {
          toast.error('ERRO', { description: result.message });
          return result;
        }
        toast.success('PRONTO', { description: result.message });
        router.refresh();
        return result;
      } finally {
        setBusy(null);
      }
    },
    [router],
  );

  return { busy, run };
}
