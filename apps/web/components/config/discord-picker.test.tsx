// @vitest-environment happy-dom
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DiscordPicker } from './discord-picker';

const ROLES = [
  {
    id: '900000000000000001',
    name: 'Moderação',
    color: 0xdc143c,
    position: 5,
    managed: false,
    hoist: true,
    mentionable: false,
    permissions: '0',
  },
];

function mockRoles() {
  const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(ROLES) }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DiscordPicker', () => {
  // O campo fechado mostrava o snowflake cru até alguém abrir o popover: a
  // lista só carregava no `open`.
  it('mostra o nome do cargo escolhido sem abrir o popover', async () => {
    mockRoles();

    render(<DiscordPicker kind="role" multiple value={[ROLES[0]!.id]} onChange={vi.fn()} />);

    // O nome vem quebrado em nós de texto (`@` + nome + `×`), então a âncora
    // é o `aria-label` do botão de remover, que carrega o nome inteiro.
    await waitFor(() => expect(screen.getByLabelText('Remover Moderação')).toBeInTheDocument());
    expect(document.body.textContent).not.toContain(ROLES[0]!.id);
  });

  // A lista vinha do cache do browser e ficava presa numa aba aberta durante
  // uma configuração: canal criado ou renomeado no meio do caminho não
  // aparecia, e o que já tinha sumido continuava na lista.
  it('pede a lista sem o cache do browser', async () => {
    const fetchMock = mockRoles();

    render(
      <DiscordPicker kind="role" includeEveryone multiple value={[ROLES[0]!.id]} onChange={vi.fn()} />,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith('/api/discord/roles', { cache: 'no-store' });
  });

  it('não pergunta ao bot quando não há nada escolhido', () => {
    const fetchMock = mockRoles();

    render(<DiscordPicker kind="role" value={[]} onChange={vi.fn()} />);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText('Nenhum cargo')).toBeInTheDocument();
  });
});
