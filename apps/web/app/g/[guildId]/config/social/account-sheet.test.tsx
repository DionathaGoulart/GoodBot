// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountSheet, EMPTY_ACCOUNT, type AccountEditing } from './account-sheet';

const resolveSocialChannelAction = vi.fn();
const saveSocialAccountAction = vi.fn();

vi.mock('@/app/actions/social', () => ({
  resolveSocialChannelAction: (input: string) => resolveSocialChannelAction(input),
  saveSocialAccountAction: (formData: FormData) => saveSocialAccountAction(formData),
}));

const LOFI = {
  channelId: 'UCSJ4gkVC6NrvII8umztf0Ow',
  title: 'Lofi Girl',
  handle: '@LofiGirl',
  avatarUrl: 'https://yt3.ggpht.com/lofi.jpg',
};

const EXISTING: AccountEditing = {
  id: 'acc-1',
  account: {
    ...EMPTY_ACCOUNT,
    externalId: LOFI.channelId,
    displayName: LOFI.title,
    handle: LOFI.handle,
    avatarUrl: LOFI.avatarUrl,
    discordChannelId: '123456789012345678',
  },
};

function renderSheet(editing: AccountEditing, readOnly = false) {
  return render(
    <AccountSheet
      editing={editing}
      embedColor={0xdc143c}
      readOnly={readOnly}
      onClose={vi.fn()}
    />,
  );
}

describe('AccountSheet — campo do canal', () => {
  beforeEach(() => {
    resolveSocialChannelAction.mockReset();
    saveSocialAccountAction.mockReset();
  });

  it('resolve a URL colada e mostra o canal encontrado sem sair da sheet', async () => {
    resolveSocialChannelAction.mockResolvedValue({ ok: true, channel: LOFI });
    renderSheet({ id: null, account: EMPTY_ACCOUNT });

    fireEvent.change(screen.getByPlaceholderText('youtube.com/@canal'), {
      target: { value: 'https://www.youtube.com/@LofiGirl' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'BUSCAR' }));

    await waitFor(() => expect(screen.getByText('Lofi Girl')).toBeInTheDocument());
    expect(screen.getByText('@LofiGirl')).toBeInTheDocument();
    expect(resolveSocialChannelAction).toHaveBeenCalledWith('https://www.youtube.com/@LofiGirl');
    // O `UC…` não é digitado em lugar nenhum: quem preenche é a resolução.
    expect(screen.queryByPlaceholderText('youtube.com/@canal')).toBeNull();
  });

  it('mostra a mensagem do bot no campo quando o canal não existe', async () => {
    resolveSocialChannelAction.mockResolvedValue({
      ok: false,
      message: 'Não encontrei esse canal no YouTube.',
    });
    renderSheet({ id: null, account: EMPTY_ACCOUNT });

    fireEvent.change(screen.getByPlaceholderText('youtube.com/@canal'), {
      target: { value: '@naoexiste-xyz-cobot' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'BUSCAR' }));

    // A mensagem sai com o prefixo `!` do §6.4, por isso o casamento por regex.
    await waitFor(() =>
      expect(screen.getByText(/Não encontrei esse canal no YouTube\./)).toBeInTheDocument(),
    );
    expect(saveSocialAccountAction).not.toHaveBeenCalled();
  });

  it('na edição o cartão já vem pronto e a busca só volta com TROCAR CANAL', () => {
    renderSheet(EXISTING);

    expect(screen.getByText('Lofi Girl')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('youtube.com/@canal')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'TROCAR CANAL' }));
    expect(screen.getByPlaceholderText('youtube.com/@canal')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'CANCELAR' }));
    expect(screen.getByText('Lofi Girl')).toBeInTheDocument();
  });

  it('em modo leitura não oferece trocar o canal', () => {
    renderSheet(EXISTING, true);

    expect(screen.getByText('Lofi Girl')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'TROCAR CANAL' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'SALVAR' })).toBeNull();
  });
});

describe('AccountSheet — tipos anunciados', () => {
  it('nasce com os três marcados e desmarca um sem mexer nos outros', () => {
    renderSheet({ id: null, account: EMPTY_ACCOUNT });

    const short = screen.getByRole('checkbox', { name: 'SHORT' });
    expect(short).toBeChecked();

    fireEvent.click(short);
    expect(short).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'VÍDEO' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'LIVE' })).toBeChecked();
  });
});
