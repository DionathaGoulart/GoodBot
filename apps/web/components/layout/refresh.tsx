'use client';

import * as React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useOffline } from 'next/offline';
import { RefreshCwIcon } from 'lucide-react';
import { toast } from 'sonner';

import { refreshGuildDataAction } from '@/app/actions/guild';
import { useGuildId } from '@/lib/use-guild-id';

/**
 * O painel se atualiza **quando alguém pede** (PRD §6.9). Até a Etapa 22 ele
 * revalidava sozinho a cada 10 s, e a conta não fechava: uma aba aberta era
 * 360 invocações por hora na Vercel para um servidor onde quase nada muda
 * nesse ritmo. No celular era pior — um `router.refresh()` cujo pedido RSC
 * falha faz o Next recarregar a página inteira, e em rede móvel essa recarga
 * também falha: sobrava a tela de erro do browser.
 *
 * Sem relógio, sem `setInterval`, sem preferência para guardar. Fica o botão,
 * e o botão faz duas coisas na ordem certa:
 *
 * 1. **invalida o cache** de dados daquela guild (`revalidateTag`) — as
 *    leituras do dashboard ficam em `unstable_cache`, então sem isto o clique
 *    devolveria o mesmo dado cacheado e pareceria um botão quebrado;
 * 2. **revalida a rota** (`router.refresh()`) — o React reconcilia e troca só
 *    o que mudou na tela; o que continua igual nem pisca.
 *
 * Navegar entre telas continua trazendo dado novo, e aí o cache é o que faz a
 * troca de tela ser barata.
 */

interface RefreshValue {
  refresh: () => void;
  /** Enquanto o pedido está no ar: o botão gira e não aceita outro clique. */
  pending: boolean;
  /**
   * Epoch ms da última atualização. Função e não valor: o indicador já
   * re-renderiza uma vez por segundo sozinho, então guardar isto num `ref`
   * poupa um render do painel inteiro a cada refresh.
   */
  refreshedAt: () => number;
}

const RefreshContext = React.createContext<RefreshValue | null>(null);

/** Um tique por segundo, para o contador da topbar. `0` = ainda no servidor. */
function subscribeSecond(onChange: () => void): () => void {
  const timer = setInterval(onChange, 1000);
  return () => clearInterval(timer);
}

export function RefreshProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const guildId = useGuildId();
  const [pending, startTransition] = React.useTransition();
  const stamp = React.useRef(0);
  const refreshedAt = React.useCallback(() => stamp.current, []);

  // Navegar já traz dados novos: o contador recomeça do zero em cada tela.
  React.useEffect(() => {
    stamp.current = Date.now();
  }, [pathname]);

  const refresh = React.useCallback(() => {
    startTransition(async () => {
      // Falhar aqui não pode derrubar a tela: sem rede o dado velho continua
      // valendo, e quem está olhando só precisa saber que não atualizou.
      try {
        await refreshGuildDataAction(guildId);
      } catch {
        toast.error('ERRO', { description: 'Não foi possível atualizar agora.' });
        return;
      }
      stamp.current = Date.now();
      router.refresh();
    });
  }, [guildId, router]);

  const value = React.useMemo<RefreshValue>(
    () => ({ refresh, pending, refreshedAt }),
    [refresh, pending, refreshedAt],
  );

  return <RefreshContext.Provider value={value}>{children}</RefreshContext.Provider>;
}

/** `null` fora do provider — o indicador simplesmente não aparece. */
export function useRefresh(): RefreshValue | null {
  return React.useContext(RefreshContext);
}

/** `ms` → `MM:SS`, estável em largura para o texto não dançar na topbar. */
export function elapsedLabel(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds >= 3600) return '1H+';
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * §3 (micro-texto) e §6.9 — "ATUALIZADO HÁ 00:07" e o botão que atualiza.
 *
 * O contador importa mais agora do que quando o painel se atualizava sozinho:
 * ele é a única pista de quão velho está o que se está lendo.
 */
export function RefreshIndicator() {
  const context = useRefresh();
  /**
   * `next/offline`: o router marca offline quando um pedido falha na rede, não
   * só quando o sistema desliga a interface. Clicar em atualizar sem rede não
   * ia trazer nada, então o botão sai do caminho.
   */
  const offline = useOffline();
  // `0` no servidor: o indicador só existe depois da hidratação, e assim não
  // há como o HTML do servidor discordar do primeiro render do cliente.
  const now = React.useSyncExternalStore(
    subscribeSecond,
    () => Date.now(),
    () => 0,
  );

  if (!context || now === 0) return null;

  const state = offline
    ? 'SEM REDE'
    : context.pending
      ? 'ATUALIZANDO'
      : `HÁ ${elapsedLabel(now - context.refreshedAt())}`;

  return (
    <div className="flex items-center gap-1.5">
      <span
        className="screen-meta hidden sm:inline"
        title={
          offline
            ? 'Sem conexão: nada a atualizar até a rede voltar.'
            : 'Há quanto tempo esta tela foi carregada. O painel não se atualiza sozinho.'
        }
      >
        ATUALIZADO {state}
      </span>
      <button
        type="button"
        className="icon-btn"
        disabled={offline || context.pending}
        onClick={context.refresh}
        aria-label="Atualizar agora"
        title="Atualizar agora"
      >
        <RefreshCwIcon className={`size-3.5${context.pending ? ' animate-spin' : ''}`} />
      </button>
    </div>
  );
}
