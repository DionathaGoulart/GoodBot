// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TEST_GUILD_ID } from '@/vitest.setup';

import { EMPTY_GAME, GameSheet } from './game-sheet';

const saveSquadGameAction = vi.fn();

vi.mock('@/app/actions/squads', () => ({
  saveSquadGameAction: (guildId: string, formData: FormData) =>
    saveSquadGameAction(guildId, formData),
}));

function renderSheet() {
  return render(
    <GameSheet
      editing={{ id: null, game: EMPTY_GAME }}
      searchPublished={false}
      readOnly={false}
      onClose={vi.fn()}
    />,
  );
}

function addQuestion(label: string) {
  fireEvent.click(screen.getByRole('button', { name: 'ADICIONAR PERGUNTA' }));
  const inputs = screen.getAllByLabelText(/^Pergunta/);
  fireEvent.change(inputs[inputs.length - 1] as HTMLElement, { target: { value: label } });
}

// Sozinho o arquivo roda em ~2 s, mas no `pnpm test` da raiz ele divide a
// máquina com os outros pacotes e o primeiro render do sheet passou dos 5 s
// padrão do Vitest.
describe('GameSheet', { timeout: 20_000 }, () => {
  beforeEach(() => {
    saveSquadGameAction.mockReset();
  });

  it('para de oferecer pergunta nova no limite do modal do Discord', () => {
    renderSheet();

    for (let count = 0; count < 5; count++) {
      fireEvent.click(screen.getByRole('button', { name: 'ADICIONAR PERGUNTA' }));
    }

    expect(screen.getAllByRole('button', { name: 'REMOVER PERGUNTA' })).toHaveLength(5);
    expect(screen.getByRole('button', { name: 'ADICIONAR PERGUNTA' })).toBeDisabled();
    expect(screen.getByText(/LIMITE DO MODAL DO DISCORD/)).toBeInTheDocument();
  });

  it('recusa pergunta de escolha sem opções e não chama o servidor', async () => {
    renderSheet();
    fireEvent.change(screen.getByLabelText(/^Nome/), { target: { value: 'Helldivers 2' } });
    addQuestion('Plataforma');

    fireEvent.click(screen.getByRole('button', { name: 'SALVAR' }));

    await waitFor(() =>
      expect(screen.getByText(/Adicione pelo menos uma opção\./)).toBeInTheDocument(),
    );
    expect(saveSquadGameAction).not.toHaveBeenCalled();
  });

  it('aponta a opção repetida', async () => {
    renderSheet();
    fireEvent.change(screen.getByLabelText(/^Nome/), { target: { value: 'Helldivers 2' } });
    addQuestion('Plataforma');
    fireEvent.change(screen.getByLabelText(/^Opções/), { target: { value: 'PC\nPS5\nPC' } });

    fireEvent.click(screen.getByRole('button', { name: 'SALVAR' }));

    await waitFor(() => expect(screen.getByText(/Opção repetida\./)).toBeInTheDocument());
    expect(saveSquadGameAction).not.toHaveBeenCalled();
  });

  it('squad e party vão no jogo, e party maior que o squad volta marcada', async () => {
    saveSquadGameAction.mockResolvedValue({ ok: true });
    renderSheet();
    fireEvent.change(screen.getByLabelText(/^Nome/), { target: { value: 'Helldivers 2' } });
    // O label do NumberField aponta para o wrapper do input e do sufixo.
    const groupSize = document.querySelector('input[name="groupSize"]') as HTMLInputElement;
    fireEvent.change(groupSize, { target: { value: '3' } });

    fireEvent.click(screen.getByRole('button', { name: 'SALVAR' }));

    await waitFor(() =>
      expect(screen.getByText(/A party não pode ser maior que o squad\./)).toBeInTheDocument(),
    );
    expect(saveSquadGameAction).not.toHaveBeenCalled();

    fireEvent.change(groupSize, { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'SALVAR' }));

    await waitFor(() => expect(saveSquadGameAction).toHaveBeenCalledTimes(1));
    const [, formData] = saveSquadGameAction.mock.calls[0] as [string, FormData];
    expect(JSON.parse(String(formData.get('game')))).toMatchObject({ groupSize: 12, partySize: 4 });
  });

  it('gera a chave pela pergunta e manda uma opção por linha', async () => {
    saveSquadGameAction.mockResolvedValue({ ok: true });
    renderSheet();
    fireEvent.change(screen.getByLabelText(/^Nome/), { target: { value: 'Helldivers 2' } });
    addQuestion('Plataforma');
    fireEvent.change(screen.getByLabelText(/^Opções/), { target: { value: ' PC \n\nPS5\n' } });

    fireEvent.click(screen.getByRole('button', { name: 'SALVAR' }));

    await waitFor(() => expect(saveSquadGameAction).toHaveBeenCalledTimes(1));
    const [guildId, formData] = saveSquadGameAction.mock.calls[0] as [string, FormData];
    expect(guildId).toBe(TEST_GUILD_ID);
    const game = JSON.parse(String(formData.get('game'))) as { name: string; fields: unknown[] };
    expect(game.name).toBe('Helldivers 2');
    expect(game.fields).toEqual([
      {
        key: 'plataforma',
        label: 'Plataforma',
        type: 'select',
        options: ['PC', 'PS5'],
        required: false,
        match: 'soft',
      },
    ]);
  });
});
