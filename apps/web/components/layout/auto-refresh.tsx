'use client';

import * as React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useOffline } from 'next/offline';
import { PauseIcon, PlayIcon, RefreshCwIcon } from 'lucide-react';

/**
 * Etapa 22 — o painel se atualiza sozinho por `router.refresh()`, não por SSE.
 * O painel roda na Vercel e o bot numa VM de 1 GB atrás do Caddy: manter uma
 * conexão aberta por aba custaria mais do que vale para um servidor de treze
 * pessoas, e ainda pediria auth no stream. Um refresh periódico usa exatamente
 * o mesmo caminho de dados que o `F5` já usava.
 *
 * Quatro coisas seguram o gatilho, e as quatro importam:
 *
 * · **aba escondida** — sem isso uma aba esquecida bate na API do bot a noite
 *   inteira, e a API do bot tem rate limit por IP (PRD §7.4);
 * · **formulário sujo** — trocar o conteúdo da tela por baixo de quem está
 *   digitando é pior do que mostrar um dado velho;
 * · **preferência desligada** — quem não quer, fica só com o botão manual;
 * · **sem rede** — um `router.refresh()` cujo pedido RSC falha faz o Next
 *   recarregar a página inteira no `location.href`, e essa recarga também
 *   falha: sobra a tela de erro do browser. Revalidar offline não traz dado
 *   novo nenhum, então nem tentamos.
 */

/** Telas de configuração quase não mudam sozinhas; o resto muda a toda hora. */
export const LIVE_INTERVAL_MS = 10_000;
export const CONFIG_INTERVAL_MS = 30_000;

const STORAGE_KEY = 'cobot:auto-refresh';

/** O intervalo é por tela, derivado da rota — não há um número global. */
export function refreshIntervalFor(pathname: string): number {
  return /^\/g\/[^/]+\/config(\/|$)/.test(pathname) ? CONFIG_INTERVAL_MS : LIVE_INTERVAL_MS;
}

/**
 * Volta a valer a partir de quanto tempo depois da última revalidação. No
 * celular `visibilitychange` e `focus` chegam os dois quando a aba volta:
 * sem isto, uma volta vira duas revalidações coladas.
 */
const RESUME_GRACE_MS = 2_000;

/**
 * `navigator.onLine` só é confiável no negativo — `true` não promete rede,
 * mas `false` é rede desligada mesmo, e é o caso que importa aqui.
 */
export function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/** A decisão inteira do gatilho, isolada do React para poder ser testada. */
export function shouldRefresh(state: {
  enabled: boolean;
  hidden: boolean;
  paused: boolean;
  offline: boolean;
}): boolean {
  return state.enabled && !state.hidden && !state.paused && !state.offline;
}

interface AutoRefreshValue {
  enabled: boolean;
  toggle: () => void;
  /** Revalidação imediata, disponível mesmo com o automático desligado. */
  refresh: () => void;
  /**
   * Epoch ms da última revalidação. Função e não valor: o indicador já
   * re-renderiza sozinho uma vez por segundo, então guardar isto num `ref`
   * poupa um render do painel inteiro a cada refresh.
   */
  refreshedAt: () => number;
  /** Quantos formulários sujos estão segurando o gatilho agora. */
  paused: boolean;
  setPaused: (id: string, paused: boolean) => void;
}

const AutoRefreshContext = React.createContext<AutoRefreshValue | null>(null);

/**
 * A preferência mora no `localStorage`, que é um sistema externo ao React —
 * daí `useSyncExternalStore` e não um `useState` sincronizado por efeito. De
 * quebra, o evento `storage` faz duas abas do painel concordarem sozinhas.
 *
 * `localStorage` pode lançar (cookies bloqueados) e não existe no servidor;
 * ligado é o padrão nos dois casos.
 */
const PREFERENCE_EVENT = 'cobot:auto-refresh-changed';

function readPreference(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

function writePreference(enabled: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    // Sem `localStorage` a preferência vale só nesta aba. Tudo bem.
  }
  window.dispatchEvent(new Event(PREFERENCE_EVENT));
}

function subscribePreference(onChange: () => void): () => void {
  window.addEventListener(PREFERENCE_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(PREFERENCE_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

/** Um tique por segundo, para o contador da topbar. `0` = ainda no servidor. */
function subscribeSecond(onChange: () => void): () => void {
  const timer = setInterval(onChange, 1000);
  return () => clearInterval(timer);
}

export function AutoRefreshProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const enabled = React.useSyncExternalStore(subscribePreference, readPreference, () => true);
  // Um `Set` e não um booleano: duas abas de formulário na mesma tela podem
  // estar sujas, e a última a limpar é que solta o gatilho.
  const [pausedBy, setPausedBy] = React.useState<ReadonlySet<string>>(() => new Set());
  const stamp = React.useRef(0);
  const refreshedAt = React.useCallback(() => stamp.current, []);

  const refresh = React.useCallback(() => {
    stamp.current = Date.now();
    router.refresh();
  }, [router]);

  const toggle = React.useCallback(() => writePreference(!readPreference()), []);

  const setPaused = React.useCallback((id: string, paused: boolean) => {
    setPausedBy((current) => {
      if (current.has(id) === paused) return current;
      const next = new Set(current);
      if (paused) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const paused = pausedBy.size > 0;
  const intervalMs = refreshIntervalFor(pathname);

  // Navegar já traz dados novos: o contador recomeça do zero em cada tela.
  React.useEffect(() => {
    stamp.current = Date.now();
  }, [pathname]);

  React.useEffect(() => {
    if (!enabled || paused) return;

    let timer: ReturnType<typeof setInterval> | undefined;

    const tick = () => {
      const hidden = document.visibilityState === 'hidden';
      if (!shouldRefresh({ enabled, paused, hidden, offline: isOffline() })) return;
      refresh();
    };

    const stop = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    };

    const start = () => {
      stop();
      timer = setInterval(tick, intervalMs);
    };

    /**
     * Voltar para a aba atualiza na hora: ela ficou parada o tempo todo. Os
     * três eventos que trazem a aba de volta caem aqui, e o `RESUME_GRACE_MS`
     * é o que impede que uma volta só dispare três revalidações.
     */
    const resume = () => {
      if (document.visibilityState === 'hidden') {
        stop();
        return;
      }
      if (Date.now() - stamp.current >= RESUME_GRACE_MS) tick();
      start();
    };

    if (document.visibilityState !== 'hidden') start();
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', resume);
    window.addEventListener('online', resume);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('focus', resume);
      window.removeEventListener('online', resume);
    };
  }, [enabled, paused, intervalMs, refresh]);

  const value = React.useMemo<AutoRefreshValue>(
    () => ({ enabled, toggle, refresh, refreshedAt, paused, setPaused }),
    [enabled, toggle, refresh, refreshedAt, paused, setPaused],
  );

  return <AutoRefreshContext.Provider value={value}>{children}</AutoRefreshContext.Provider>;
}

/** `null` fora do provider — o indicador simplesmente não aparece. */
export function useAutoRefresh(): AutoRefreshValue | null {
  return React.useContext(AutoRefreshContext);
}

/**
 * Segura o auto-refresh enquanto `active` for verdadeiro. O `ConfigForm` passa
 * o seu `isDirty`; qualquer outro formulário longo pode fazer o mesmo.
 */
export function useAutoRefreshPause(active: boolean): void {
  const context = React.useContext(AutoRefreshContext);
  const setPaused = context?.setPaused;
  const id = React.useId();

  React.useEffect(() => {
    if (!setPaused) return;
    setPaused(id, active);
    return () => setPaused(id, false);
  }, [setPaused, id, active]);
}

/** `ms` → `MM:SS`, estável em largura para o texto não dançar na topbar. */
export function elapsedLabel(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds >= 3600) return '1H+';
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * §3 (micro-texto) e §6.9 — "ATUALIZADO HÁ 00:07" mais o botão de refresh
 * manual e o liga/desliga do automático.
 */
export function AutoRefreshIndicator() {
  const context = useAutoRefresh();
  /**
   * `next/offline`: o próprio router marca offline quando um pedido falha na
   * rede, não só quando o sistema desliga a interface. Enquanto isso ele
   * segura os pedidos em vez de recarregar a página — o indicador é o que
   * conta essa espera para quem está olhando.
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

  const label = elapsedLabel(now - context.refreshedAt());
  const state = offline
    ? 'SEM REDE'
    : !context.enabled
      ? 'PAUSADO'
      : context.paused
        ? 'ESPERANDO'
        : `HÁ ${label}`;

  return (
    <div className="flex items-center gap-1.5">
      <span
        className="screen-meta hidden sm:inline"
        title={
          offline
            ? 'Sem conexão: o painel volta a se atualizar sozinho quando a rede voltar.'
            : context.paused
              ? 'Formulário com alterações não salvas: o painel não se atualiza sozinho enquanto isso.'
              : 'Última atualização automática da tela.'
        }
      >
        ATUALIZADO {state}
      </span>
      <button
        type="button"
        className="icon-btn"
        onClick={context.refresh}
        aria-label="Atualizar agora"
        title="Atualizar agora"
      >
        <RefreshCwIcon className="size-3.5" />
      </button>
      <button
        type="button"
        className="icon-btn"
        onClick={context.toggle}
        aria-pressed={context.enabled}
        aria-label={
          context.enabled ? 'Desligar a atualização automática' : 'Ligar a atualização automática'
        }
        title={
          context.enabled ? 'Desligar a atualização automática' : 'Ligar a atualização automática'
        }
      >
        {context.enabled ? <PauseIcon className="size-3.5" /> : <PlayIcon className="size-3.5" />}
      </button>
    </div>
  );
}
