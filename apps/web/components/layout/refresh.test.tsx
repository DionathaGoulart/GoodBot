// @vitest-environment happy-dom
import * as React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RefreshIndicator, RefreshProvider, elapsedLabel } from './refresh';

const routerRefresh = vi.fn();
const action = vi.fn<(guildId: string) => Promise<void>>(() => Promise.resolve());
let offline = false;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: routerRefresh }),
  usePathname: () => '/g/1/membros',
  useParams: () => ({ guildId: '1' }),
}));

vi.mock('next/offline', () => ({ useOffline: () => offline }));

vi.mock('@/app/actions/guild', () => ({
  refreshGuildDataAction: (guildId: string) => action(guildId),
}));

const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (...args: unknown[]) => toastError(...args) } }));

beforeEach(() => {
  routerRefresh.mockClear();
  action.mockClear();
  action.mockImplementation(() => Promise.resolve());
  toastError.mockClear();
  offline = false;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** O indicador só aparece depois do primeiro tique do relógio do cliente. */
function renderIndicator() {
  render(
    <RefreshProvider>
      <RefreshIndicator />
    </RefreshProvider>,
  );
  act(() => void vi.advanceTimersByTime(1000));
}

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

describe('RefreshProvider', () => {
  it('não atualiza sozinho: sem clique, nada acontece', () => {
    renderIndicator();

    act(() => void vi.advanceTimersByTime(10 * 60 * 1000));
    expect(action).not.toHaveBeenCalled();
    expect(routerRefresh).not.toHaveBeenCalled();
  });

  it('o clique derruba o cache da guild antes de revalidar a rota', async () => {
    renderIndicator();

    await act(async () => {
      screen.getByLabelText('Atualizar agora').click();
    });

    expect(action).toHaveBeenCalledWith('1');
    expect(routerRefresh).toHaveBeenCalledTimes(1);
  });

  it('falhou o pedido, a tela fica como está e o aviso sai', async () => {
    action.mockImplementation(() => Promise.reject(new Error('offline')));
    renderIndicator();

    await act(async () => {
      screen.getByLabelText('Atualizar agora').click();
    });

    // Revalidar a rota depois de falhar é o que fazia o Next recarregar a
    // página inteira e cair na tela de erro do browser.
    expect(routerRefresh).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalled();
  });

  it('sem rede o botão sai do caminho', () => {
    offline = true;
    renderIndicator();

    expect(screen.getByText(/SEM REDE/)).toBeInTheDocument();
    expect(screen.getByLabelText('Atualizar agora')).toBeDisabled();
  });
});
