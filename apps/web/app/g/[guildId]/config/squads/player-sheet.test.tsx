// @vitest-environment happy-dom
import { DEFAULT_SQUAD_BLOCKS, toBits, type SquadGameField } from '@goodbot/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TEST_GUILD_ID } from '@/vitest.setup';

import { PlayerSheet } from './player-sheet';

import type { PlayerRow, SquadPlayersData } from '@/lib/squad-players';
import type { SquadGameRow } from '@/lib/squads';

const setPlayerStatusAction = vi.fn();
const deletePlayerProfileAction = vi.fn();
const removePlayerFromSquadAction = vi.fn();
const editPlayerAnswersAction = vi.fn();
const toastSuccess = vi.fn();
const toastWarning = vi.fn();
const toastError = vi.fn();

vi.mock('@/app/actions/squads', () => ({
  setPlayerStatusAction: (guildId: string, formData: FormData) =>
    setPlayerStatusAction(guildId, formData),
  deletePlayerProfileAction: (guildId: string, formData: FormData) =>
    deletePlayerProfileAction(guildId, formData),
  removePlayerFromSquadAction: (guildId: string, formData: FormData) =>
    removePlayerFromSquadAction(guildId, formData),
  editPlayerAnswersAction: (guildId: string, formData: FormData) =>
    editPlayerAnswersAction(guildId, formData),
}));

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    warning: (...args: unknown[]) => toastWarning(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

const GAME_ID = '11111111-1111-4111-8111-111111111111';
const ALFA = '33333333-3333-4333-8333-333333333333';
const ANA = '300000000000000001';

const FIELDS: SquadGameField[] = [
  { key: 'nick', label: 'Nick', type: 'text', options: [], required: true, match: 'none' },
  {
    key: 'plataforma',
    label: 'Plataforma',
    type: 'select',
    options: ['PC', 'PS5'],
    required: false,
    match: 'hard',
  },
];

const GAME: SquadGameRow = {
  id: GAME_ID,
  name: 'Helldivers 2',
  groupSize: 4,
  partySize: 4,
  enabled: true,
  fields: FIELDS,
};

const DATA: SquadPlayersData = {
  profiles: [],
  openProposals: [
    {
      id: 'p1',
      gameId: GAME_ID,
      userIds: [ANA, '300000000000000002'],
      acceptedIds: [],
      declinedIds: [],
      squadId: null,
      threadId: '500000000000000001',
      expiresAt: '2026-09-15T12:00:00.000Z',
      createdAt: '2026-09-14T12:00:00.000Z',
    },
  ],
  liveSquads: [
    {
      id: ALFA,
      gameId: GAME_ID,
      name: 'Alfa',
      status: 'open',
      textChannelId: null,
      memberIds: [ANA],
    },
  ],
  pendingRequests: [
    { id: 'r1', squadId: ALFA, userId: ANA, status: 'pending', createdAt: '2026-09-12T12:00:00.000Z' },
  ],
  cooldownPairs: {},
  members: {},
  missingMemberIds: [],
  unresolvedMemberIds: [],
  membersError: null,
};

function player(overrides: Partial<PlayerRow> = {}): PlayerRow {
  return {
    userId: ANA,
    gameId: GAME_ID,
    status: 'searching',
    availability: toBits([{ day: 6, block: 2 }]),
    answers: { nick: 'ana_hd', plataforma: 'PC' },
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: '2026-09-10T12:00:00.000Z',
    lastMatchedAt: null,
    name: 'Ana',
    username: 'ana',
    avatarUrl: null,
    inGuild: true,
    squadIds: [],
    openProposalIds: [],
    pendingRequestSquadIds: [],
    activeSquadCount: 0,
    inSquadInGame: false,
    ...overrides,
  };
}

function renderSheet(row: PlayerRow) {
  const onChanged = vi.fn();
  const onClose = vi.fn();
  render(
    <PlayerSheet
      player={row}
      game={GAME}
      data={DATA}
      blocks={[...DEFAULT_SQUAD_BLOCKS]}
      timeZone="America/Sao_Paulo"
      onClose={onClose}
      onChanged={onChanged}
    />,
  );
  return { onChanged, onClose };
}

function sentPayload(mock: ReturnType<typeof vi.fn>): unknown {
  const [guildId, formData] = mock.mock.calls[0] as [string, FormData];
  expect(guildId).toBe(TEST_GUILD_ID);
  return JSON.parse(String(formData.get('payload'))) as unknown;
}

/** Abre o diálogo pelo botão, escreve o motivo e devolve o diálogo. */
async function confirmWithReason(button: string, reason: string) {
  fireEvent.click(screen.getByRole('button', { name: button }));
  const dialog = await screen.findByRole('alertdialog');
  fireEvent.change(within(dialog).getByLabelText(/^Motivo/), { target: { value: reason } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'CONFIRMAR' }));
  return dialog;
}

describe('PlayerSheet', { timeout: 20_000 }, () => {
  beforeEach(() => {
    for (const mock of [
      setPlayerStatusAction,
      deletePlayerProfileAction,
      removePlayerFromSquadAction,
      editPlayerAnswersAction,
      toastSuccess,
      toastWarning,
      toastError,
    ]) {
      mock.mockReset();
    }
  });

  it('quem está num squad do jogo não pode ser pausado nem apagado', () => {
    renderSheet(player({ status: 'in_squad', squadIds: [ALFA], activeSquadCount: 1, inSquadInGame: true }));

    expect(screen.queryByRole('button', { name: 'PAUSAR' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'VOLTAR A PROCURAR' })).not.toBeInTheDocument();
    expect(screen.getByText('EM SQUAD: SÓ O BOT MUDA ESTE STATUS')).toBeInTheDocument();
    expect(screen.getByText('EM 1 SQUAD NO SERVIDOR')).toBeInTheDocument();
    const remove = screen.getByRole('button', { name: 'APAGAR PERFIL' });
    expect(remove).toBeDisabled();
    expect(remove).toHaveAccessibleDescription('EM SQUAD DESTE JOGO: TIRE DO SQUAD ANTES DE APAGAR');
  });

  it('in_squad atrasado, sem squad vivo, mostra PAUSAR para corrigir o status', () => {
    renderSheet(player({ status: 'in_squad', inSquadInGame: true }));

    expect(screen.getByRole('button', { name: 'PAUSAR' })).toBeEnabled();
    expect(screen.queryByText('EM SQUAD: SÓ O BOT MUDA ESTE STATUS')).not.toBeInTheDocument();
  });

  it.each<[string, Partial<PlayerRow>, string]>([
    ['proposta aberta', { openProposalIds: ['p1'] }, 'EM PROPOSTA ABERTA: ESPERE ELA FECHAR OU EXPIRAR'],
    ['pedido pendente', { pendingRequestSquadIds: [ALFA] }, 'COM CONVITE OU PEDIDO DE ENTRADA ABERTO'],
  ])('apagar fica desabilitado com o motivo quando há %s', (_label, overrides, reason) => {
    renderSheet(player(overrides));

    const remove = screen.getByRole('button', { name: 'APAGAR PERFIL' });
    expect(remove).toBeDisabled();
    expect(remove).toHaveAccessibleDescription(reason);
  });

  it('PAUSAR exige motivo e manda o motivo sem espaços nas pontas', async () => {
    setPlayerStatusAction.mockResolvedValue({
      ok: true,
      notified: true,
      message: 'Busca pausada e a pessoa foi avisada por DM.',
    });
    const { onChanged } = renderSheet(player());

    fireEvent.click(screen.getByRole('button', { name: 'PAUSAR' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('PAUSAR A BUSCA DE ANA?')).toBeInTheDocument();
    const confirm = within(dialog).getByRole('button', { name: 'CONFIRMAR' });
    const reason = within(dialog).getByLabelText(/^Motivo/);
    expect(confirm).toBeDisabled();
    fireEvent.change(reason, { target: { value: '   ' } });
    expect(confirm).toBeDisabled();
    fireEvent.change(reason, { target: { value: '  Sumiu das sessões  ' } });
    fireEvent.click(confirm);

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(sentPayload(setPlayerStatusAction)).toEqual({
      gameId: GAME_ID,
      userId: ANA,
      status: 'paused',
      reason: 'Sumiu das sessões',
    });
    expect(toastSuccess).toHaveBeenCalledWith('PRONTO', {
      description: 'Busca pausada e a pessoa foi avisada por DM.',
    });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('perfil pausado ganha VOLTAR A PROCURAR', async () => {
    setPlayerStatusAction.mockResolvedValue({ ok: true, notified: true, message: 'ok' });
    renderSheet(player({ status: 'paused' }));

    await confirmWithReason('VOLTAR A PROCURAR', 'Voltou a jogar');

    await waitFor(() => expect(setPlayerStatusAction).toHaveBeenCalledTimes(1));
    expect(sentPayload(setPlayerStatusAction)).toMatchObject({ status: 'searching' });
  });

  it('DM que não chegou vira aviso de que a pessoa não foi avisada', async () => {
    const message =
      'Busca pausada, mas não consegui avisar a pessoa por DM (DM fechada ou fora do servidor).';
    setPlayerStatusAction.mockResolvedValue({ ok: true, notified: false, message });
    renderSheet(player());

    await confirmWithReason('PAUSAR', 'Sumiu das sessões');

    await waitFor(() =>
      expect(toastWarning).toHaveBeenCalledWith('FEITO, SEM DM', { description: message }),
    );
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('erro do bot mantém o diálogo aberto com o motivo digitado', async () => {
    setPlayerStatusAction.mockResolvedValue({
      ok: false,
      message: 'Esta pessoa está num squad deste jogo.',
    });
    const { onChanged } = renderSheet(player());

    const dialog = await confirmWithReason('PAUSAR', 'Sumiu das sessões');

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('alertdialog')).toBe(dialog);
    expect(within(dialog).getByLabelText(/^Motivo/)).toHaveValue('Sumiu das sessões');
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('REMOVER tira a pessoa do squad com squad, pessoa e motivo', async () => {
    removePlayerFromSquadAction.mockResolvedValue({ ok: true, notified: true, message: 'ok' });
    renderSheet(player({ status: 'in_squad', squadIds: [ALFA], activeSquadCount: 1, inSquadInGame: true }));

    fireEvent.click(screen.getByRole('button', { name: 'REMOVER' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('TIRAR ANA DO SQUAD ALFA?')).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/^Motivo/), {
      target: { value: 'Faltou três sessões' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'CONFIRMAR' }));

    await waitFor(() => expect(removePlayerFromSquadAction).toHaveBeenCalledTimes(1));
    expect(sentPayload(removePlayerFromSquadAction)).toEqual({
      squadId: ALFA,
      userId: ANA,
      reason: 'Faltou três sessões',
    });
  });

  it('APAGAR PERFIL chama a action de apagar e fecha o perfil', async () => {
    deletePlayerProfileAction.mockResolvedValue({ ok: true, notified: true, message: 'ok' });
    const { onClose, onChanged } = renderSheet(player());

    await confirmWithReason('APAGAR PERFIL', 'Perfil de teste');

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(sentPayload(deletePlayerProfileAction)).toEqual({
      gameId: GAME_ID,
      userId: ANA,
      reason: 'Perfil de teste',
    });
  });

  it('editar sem o obrigatório ou sem motivo não chama a action', async () => {
    renderSheet(player());

    fireEvent.click(screen.getByRole('button', { name: 'EDITAR' }));
    fireEvent.change(screen.getByLabelText(/^Nick/), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'SALVAR' }));

    expect(await screen.findByText(/Escreva o motivo\. Ele vai na DM da pessoa\./)).toBeInTheDocument();
    expect(screen.getByText(/Campo obrigatório\./)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Nick/)).toHaveAttribute('aria-invalid', 'true');
    expect(editPlayerAnswersAction).not.toHaveBeenCalled();
  });

  it('editar manda as respostas e o motivo', async () => {
    editPlayerAnswersAction.mockResolvedValue({ ok: true, notified: true, message: 'ok' });
    const { onChanged } = renderSheet(player());

    fireEvent.click(screen.getByRole('button', { name: 'EDITAR' }));
    fireEvent.change(screen.getByLabelText(/^Nick/), { target: { value: 'ana_certa' } });
    fireEvent.change(screen.getByLabelText(/^Motivo/), { target: { value: 'Nick errado' } });
    fireEvent.click(screen.getByRole('button', { name: 'SALVAR' }));

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(sentPayload(editPlayerAnswersAction)).toEqual({
      gameId: GAME_ID,
      userId: ANA,
      answers: { nick: 'ana_certa', plataforma: 'PC' },
      reason: 'Nick errado',
    });
  });
});
