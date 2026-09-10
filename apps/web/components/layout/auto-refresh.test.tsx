// @vitest-environment happy-dom
import * as React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AutoRefreshIndicator,
  AutoRefreshProvider,
  CONFIG_INTERVAL_MS,
  LIVE_INTERVAL_MS,
  elapsedLabel,
  refreshIntervalFor,
  shouldRefresh,
  useAutoRefreshPause,
} from './auto-refresh';

const refresh = vi.fn();
let pathname = '/g/1/membros';
let offline = false;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
  usePathname: () => pathname,
}));

vi.mock('next/offline', () => ({ useOffline: () => offline }));

/** O happy-dom não deixa escrever em `navigator.onLine`; este stub deixa. */
function setOnline(online: boolean): void {
  offline = !online;
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
}

/** O happy-dom não deixa escrever em `visibilityState`; este stub deixa. */
function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
}

function Dirty({ dirty }: { dirty: boolean }) {
  useAutoRefreshPause(dirty);
  return null;
}

beforeEach(() => {
  refresh.mockClear();
  pathname = '/g/1/membros';
  setVisibility('visible');
  setOnline(true);
  window.localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('refreshIntervalFor', () => {
  it('usa 30 s nas telas de config e 10 s no resto', () => {
    expect(refreshIntervalFor('/g/123/config')).toBe(CONFIG_INTERVAL_MS);
    expect(refreshIntervalFor('/g/123/config/automod')).toBe(CONFIG_INTERVAL_MS);
    expect(refreshIntervalFor('/g/123/membros')).toBe(LIVE_INTERVAL_MS);
    expect(refreshIntervalFor('/g/123')).toBe(LIVE_INTERVAL_MS);
    // `configuracoes` não é `config`: o prefixo tem de bater no segmento todo.
    expect(refreshIntervalFor('/g/123/configuracoes')).toBe(LIVE_INTERVAL_MS);
  });
});

describe('shouldRefresh', () => {
  it('só dispara com a aba visível, com rede, sem pausa e com a preferência ligada', () => {
    const on = { enabled: true, hidden: false, paused: false, offline: false };
    expect(shouldRefresh(on)).toBe(true);
    expect(shouldRefresh({ ...on, hidden: true })).toBe(false);
    expect(shouldRefresh({ ...on, paused: true })).toBe(false);
    expect(shouldRefresh({ ...on, enabled: false })).toBe(false);
    expect(shouldRefresh({ ...on, offline: true })).toBe(false);
  });
});

describe('elapsedLabel', () => {
  it('formata em MM:SS e satura acima de uma hora', () => {
    expect(elapsedLabel(0)).toBe('00:00');
    expect(elapsedLabel(7_000)).toBe('00:07');
    expect(elapsedLabel(95_000)).toBe('01:35');
    expect(elapsedLabel(3_600_000)).toBe('1H+');
    // Relógio que voltou atrás não vira número negativo na topbar.
    expect(elapsedLabel(-5_000)).toBe('00:00');
  });
});

describe('AutoRefreshProvider', () => {
  it('revalida no intervalo da tela', () => {
    render(
      <AutoRefreshProvider>
        <AutoRefreshIndicator />
      </AutoRefreshProvider>,
    );

    act(() => void vi.advanceTimersByTime(LIVE_INTERVAL_MS));
    expect(refresh).toHaveBeenCalledTimes(1);

    act(() => void vi.advanceTimersByTime(LIVE_INTERVAL_MS));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('não dispara nada com a aba escondida e atualiza ao voltar', () => {
    render(
      <AutoRefreshProvider>
        <AutoRefreshIndicator />
      </AutoRefreshProvider>,
    );

    act(() => {
      setVisibility('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
    });

    act(() => void vi.advanceTimersByTime(LIVE_INTERVAL_MS * 5));
    expect(refresh).not.toHaveBeenCalled();

    act(() => {
      setVisibility('visible');
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('não dispara enquanto um formulário está sujo', () => {
    const { rerender } = render(
      <AutoRefreshProvider>
        <Dirty dirty />
        <AutoRefreshIndicator />
      </AutoRefreshProvider>,
    );

    act(() => void vi.advanceTimersByTime(LIVE_INTERVAL_MS * 3));
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByText(/ESPERANDO/)).toBeInTheDocument();

    // Salvou: o formulário limpa e o gatilho volta.
    rerender(
      <AutoRefreshProvider>
        <Dirty dirty={false} />
        <AutoRefreshIndicator />
      </AutoRefreshProvider>,
    );
    act(() => void vi.advanceTimersByTime(LIVE_INTERVAL_MS));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('respeita a preferência desligada do localStorage, mas mantém o botão manual', async () => {
    window.localStorage.setItem('goodbot:auto-refresh', 'off');
    render(
      <AutoRefreshProvider>
        <AutoRefreshIndicator />
      </AutoRefreshProvider>,
    );

    act(() => void vi.advanceTimersByTime(LIVE_INTERVAL_MS * 3));
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByText(/PAUSADO/)).toBeInTheDocument();

    act(() => screen.getByLabelText('Atualizar agora').click());
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('o liga/desliga persiste no localStorage', () => {
    render(
      <AutoRefreshProvider>
        <AutoRefreshIndicator />
      </AutoRefreshProvider>,
    );

    act(() => screen.getByLabelText('Desligar a atualização automática').click());
    expect(window.localStorage.getItem('goodbot:auto-refresh')).toBe('off');

    act(() => void vi.advanceTimersByTime(LIVE_INTERVAL_MS * 3));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('não revalida sem rede e volta a revalidar quando ela volta', () => {
    render(
      <AutoRefreshProvider>
        <AutoRefreshIndicator />
      </AutoRefreshProvider>,
    );

    act(() => {
      setOnline(false);
      window.dispatchEvent(new Event('offline'));
    });

    // Um `router.refresh()` que falha na rede vira recarga da página inteira,
    // e a recarga também falha: é a tela de erro do browser que o usuário vê.
    act(() => void vi.advanceTimersByTime(LIVE_INTERVAL_MS * 3));
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByText(/SEM REDE/)).toBeInTheDocument();

    act(() => {
      setOnline(true);
      window.dispatchEvent(new Event('online'));
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('uma volta para a aba revalida uma vez só, não uma por evento', () => {
    render(
      <AutoRefreshProvider>
        <AutoRefreshIndicator />
      </AutoRefreshProvider>,
    );

    act(() => {
      setVisibility('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
    });
    act(() => void vi.advanceTimersByTime(LIVE_INTERVAL_MS * 5));

    // O celular manda os dois ao desbloquear; só o primeiro revalida.
    act(() => {
      setVisibility('visible');
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('usa o intervalo mais lento nas telas de config', () => {
    pathname = '/g/1/config/automod';
    render(
      <AutoRefreshProvider>
        <AutoRefreshIndicator />
      </AutoRefreshProvider>,
    );

    act(() => void vi.advanceTimersByTime(LIVE_INTERVAL_MS));
    expect(refresh).not.toHaveBeenCalled();

    act(() => void vi.advanceTimersByTime(CONFIG_INTERVAL_MS - LIVE_INTERVAL_MS));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
