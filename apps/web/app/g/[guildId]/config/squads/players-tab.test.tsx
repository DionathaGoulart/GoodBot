// @vitest-environment happy-dom
import {
  DEFAULT_SQUAD_BLOCKS,
  toBits,
  type SquadGameField,
  type SquadProposalSummary,
} from '@goodbot/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PlayersTab } from './players-tab';

import type { PlayerProfileRow, SquadPlayersData } from '@/lib/squad-players';
import type { SquadSessionsData } from '@/lib/squad-sessions';
import type { SquadGameRow } from '@/lib/squads';
import type * as navigation from 'next/navigation';

const routerRefresh = vi.fn();

vi.mock('next/navigation', async () => {
  const actual = await vi.importActual<typeof navigation>('next/navigation');
  return {
    ...actual,
    useParams: () => ({ guildId: '111111111111111111' }),
    useRouter: () => ({ refresh: routerRefresh }),
  };
});

vi.mock('@/app/actions/squads', () => ({
  runSquadMatchAction: vi.fn(),
  checkManualSquadMatchAction: vi.fn(),
  proposeManualSquadAction: vi.fn(),
  setPlayerStatusAction: vi.fn(),
  deletePlayerProfileAction: vi.fn(),
  removePlayerFromSquadAction: vi.fn(),
  editPlayerAnswersAction: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

const GAME_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const ALFA = '33333333-3333-4333-8333-333333333333';

const ANA = '300000000000000001';
const BIA = '300000000000000002';
const CAIO = '300000000000000003';
const DAVI = '300000000000000004';
const EDU = '300000000000000005';
const FIL = '300000000000000006';

const FIELDS: SquadGameField[] = [
  {
    key: 'plataforma',
    label: 'Plataforma',
    type: 'select',
    options: ['PC', 'PS5'],
    required: true,
    match: 'hard',
  },
];

const GAMES: SquadGameRow[] = [
  { id: GAME_ID, name: 'Helldivers 2', groupSize: 4, partySize: 4, enabled: true, fields: FIELDS },
  {
    id: OTHER_ID,
    name: 'Deep Rock Galactic',
    groupSize: 4,
    partySize: 4,
    enabled: true,
    fields: [],
  },
];

const SAT_NIGHT = toBits([{ day: 6, block: 2 }]);

function profile(
  userId: string,
  plataforma: string,
  overrides: Partial<PlayerProfileRow> = {},
): PlayerProfileRow {
  return {
    userId,
    gameId: GAME_ID,
    status: 'searching',
    availability: SAT_NIGHT,
    answers: { plataforma },
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: '2026-09-10T12:00:00.000Z',
    lastMatchedAt: null,
    ...overrides,
  };
}

const PROPOSALS: SquadProposalSummary[] = [
  {
    id: 'p1',
    gameId: GAME_ID,
    userIds: [EDU, ANA],
    acceptedIds: [],
    declinedIds: [ANA],
    squadId: null,
    threadId: '500000000000000001',
    expiresAt: '2026-09-15T12:00:00.000Z',
    createdAt: '2026-09-14T12:00:00.000Z',
  },
];

const DATA: SquadPlayersData = {
  profiles: [
    profile(ANA, 'PC'),
    profile(BIA, 'PS5'),
    profile(CAIO, 'PC', { status: 'paused' }),
    profile(DAVI, 'PC', { status: 'in_squad' }),
    profile(EDU, 'PC'),
    profile(FIL, 'PC', { gameId: OTHER_ID }),
  ],
  openProposals: PROPOSALS,
  liveSquads: [
    {
      id: ALFA,
      gameId: GAME_ID,
      name: 'Alfa',
      status: 'open',
      textChannelId: null,
      memberIds: [DAVI],
    },
  ],
  pendingRequests: [],
  cooldownPairs: {},
  members: {
    [ANA]: { displayName: 'Ana', username: 'ana', avatarUrl: 'https://cdn.discordapp.com/ana.png' },
    [BIA]: { displayName: 'Bia', username: 'bia', avatarUrl: null },
    [CAIO]: { displayName: 'Caio', username: 'caio', avatarUrl: null },
    [DAVI]: { displayName: 'Davi', username: 'davi', avatarUrl: null },
    [FIL]: { displayName: 'Fil', username: 'fil', avatarUrl: null },
  },
  missingMemberIds: [EDU],
  unresolvedMemberIds: [],
  membersError: null,
};

/** A aba JOGADORES não mostra jogatina: os números do sheet saem vazios. */
const SESSIONS: SquadSessionsData = {
  sessions: [],
  attendance: [],
  squads: [],
  members: {},
  membersError: null,
  loadedAt: Date.parse('2026-09-22T12:00:00.000Z'),
  windowDays: 90,
};

function renderTab(players: SquadPlayersData | null = DATA) {
  render(
    <PlayersTab
      games={GAMES}
      players={players}
      sessions={SESSIONS}
      proposals={PROPOSALS}
      blocks={[...DEFAULT_SQUAD_BLOCKS]}
      timeZone="America/Sao_Paulo"
      maxSquadsPerUser={2}
      cooldownDays={7}
    />,
  );
}

const rowOf = (text: string) => {
  const row = screen.getAllByText(text)[0]?.closest('tr');
  if (!row) throw new Error(`linha de ${text} não existe`);
  return row;
};

/** O valor do bloco de contagem com esse rótulo. */
const tileValue = (label: string) =>
  screen
    .getAllByText(label)
    .find((element) => element.classList.contains('section-label'))
    ?.nextElementSibling?.textContent;

const statusFilter = (label: string) =>
  within(screen.getByRole('group', { name: 'Filtrar por status' })).getByRole('button', {
    name: label,
  });

const selectBox = (name: string) => screen.getByRole('checkbox', { name: `Selecionar ${name}` });

const selectionSummary = () => screen.queryByText(/SELECIONADOS? ·/);

describe('PlayersTab', { timeout: 20_000 }, () => {
  it('mostra nome e avatar do servidor e marca quem saiu', () => {
    renderTab();

    expect(rowOf('Ana').querySelector('img')?.getAttribute('src')).toBe(
      'https://cdn.discordapp.com/ana.png',
    );
    expect(within(rowOf('Ana')).getByText('@ana')).toBeInTheDocument();
    // Quem saiu fica com o ID no lugar do nome.
    expect(within(rowOf(EDU)).getByText('SAIU')).toBeInTheDocument();
    // Perfil de outro jogo não aparece.
    expect(screen.queryByText('Fil')).not.toBeInTheDocument();
  });

  it('o filtro de status muda respostas e grade, mas não os blocos de status', () => {
    renderTab();

    expect(tileValue('TOTAL')).toBe('5');
    expect(tileValue('PROCURANDO')).toBe('3');
    expect(tileValue('EM SQUAD')).toBe('1');
    expect(tileValue('PAUSADO')).toBe('1');
    expect(screen.getByTitle('SÁB NOITE · 5 JOGADORES')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Plataforma: PC' })).toHaveAttribute(
      'aria-valuenow',
      '4',
    );

    fireEvent.click(statusFilter('PAUSADO'));

    expect(statusFilter('PAUSADO')).toHaveAttribute('aria-pressed', 'true');
    expect(tileValue('TOTAL')).toBe('5');
    expect(tileValue('PROCURANDO')).toBe('3');
    expect(screen.getByTitle('SÁB NOITE · 1 JOGADOR')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Plataforma: PC' })).toHaveAttribute(
      'aria-valuenow',
      '1',
    );
    expect(screen.getByRole('progressbar', { name: 'Plataforma: PS5' })).toHaveAttribute(
      'aria-valuenow',
      '0',
    );
    expect(screen.getByText('Caio')).toBeInTheDocument();
    expect(screen.queryByText('Ana')).not.toBeInTheDocument();
  });

  it('VER abre o perfil com respostas e squad', async () => {
    renderTab();

    fireEvent.click(screen.getByRole('button', { name: 'VER Davi' }));

    const sheet = await screen.findByRole('dialog', { name: 'Davi' });
    expect(within(sheet).getByText('PLATAFORMA')).toBeInTheDocument();
    expect(within(sheet).getByText('PC')).toBeInTheDocument();
    expect(within(sheet).getByText('Alfa')).toBeInTheDocument();
    expect(within(sheet).getByText('EM 1 SQUAD NO SERVIDOR')).toBeInTheDocument();
  });

  it('VER mostra a proposta aberta de quem está numa', async () => {
    renderTab();

    fireEvent.click(screen.getByRole('button', { name: `VER ${EDU}` }));

    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('[SAIU DO SERVIDOR]')).toBeInTheDocument();
    expect(within(sheet).getByText(/TURMA DE 2 · 0 ACEITARAM/)).toBeInTheDocument();
  });

  it('moderador vê só as propostas, sem lista e sem nomes', () => {
    renderTab(null);

    expect(
      screen.getByText('A LISTA DE JOGADORES E O MATCH MANUAL SÃO SÓ PARA ADMIN'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Ana')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByText('JOGADORES.LST')).not.toBeInTheDocument();
  });

  it('marcar duas pessoas que respondem diferente no que precisa bater mostra nota e aviso', () => {
    renderTab();

    fireEvent.click(selectBox('Ana'));
    fireEvent.click(selectBox('Bia'));

    expect(selectionSummary()).toHaveTextContent(/^2 SELECIONADOS · NOTA \d+ · 1 AVISO · 0 BLOQUEIOS$/);
    expect(screen.getByText(/^Ana\+Bia \d+ PRECISA BATER: PLATAFORMA$/)).toBeInTheDocument();
    // Caio joga no PC como a Ana, mas bate de frente com a Bia; e está pausado.
    const note = within(rowOf('Caio')).getAllByRole('cell')[4];
    if (!note) throw new Error('coluna NOTA não existe');
    expect(within(note).getByText('PRECISA BATER')).toBeInTheDocument();
    expect(within(note).getByText('PAUSADO')).toBeInTheDocument();
    // A busca sai para a barra entrar.
    expect(screen.queryByPlaceholderText('BUSCAR JOGADOR')).not.toBeInTheDocument();
  });

  it('a barra só oferece propor ao grupo e limpar', () => {
    renderTab();

    fireEvent.click(selectBox('Ana'));

    const bar = selectionSummary()?.parentElement;
    if (!bar) throw new Error('barra de seleção não apareceu');
    const actions = within(bar)
      .getAllByRole('button')
      .map((button) => button.textContent)
      .filter((label) => !label?.startsWith('DUPLAS'));
    expect(actions).toEqual(['PROPOR AO GRUPO', 'LIMPAR']);
    // Uma pessoa só não forma turma.
    expect(within(bar).getByRole('button', { name: 'PROPOR AO GRUPO' })).toBeDisabled();
  });

  it('perfil pausado pode ser marcado e conta como aviso', () => {
    renderTab();

    fireEvent.click(selectBox('Ana'));
    expect(selectBox('Caio')).toBeEnabled();
    fireEvent.click(selectBox('Caio'));

    expect(selectionSummary()).toHaveTextContent(/^2 SELECIONADOS · NOTA \d+ · 1 AVISO · 0 BLOQUEIOS$/);
  });

  it('quem está num squad do jogo não pode ser marcado, e a caixa diz por quê', () => {
    renderTab();

    const davi = selectBox('Davi');
    expect(davi).toBeDisabled();
    expect(davi).toHaveAccessibleDescription('EM SQUAD DESTE JOGO: TIRE DO SQUAD ANTES DE PROPOR');
  });

  it('LIMPAR zera a seleção e devolve a busca', () => {
    renderTab();

    fireEvent.click(selectBox('Ana'));
    expect(selectBox('Ana')).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'LIMPAR' }));

    expect(selectionSummary()).not.toBeInTheDocument();
    expect(selectBox('Ana')).not.toBeChecked();
    expect(screen.getByPlaceholderText('BUSCAR JOGADOR')).toBeInTheDocument();
  });

  it('trocar de jogo zera a seleção', async () => {
    renderTab();

    fireEvent.click(selectBox('Ana'));
    expect(selectionSummary()).toBeInTheDocument();

    const pick = async (name: string) => {
      fireEvent.keyDown(screen.getByRole('combobox', { name: 'Jogo' }), { key: 'Enter' });
      fireEvent.click(await screen.findByRole('option', { name }));
    };

    await pick('Deep Rock Galactic');
    await waitFor(() => expect(screen.queryByText('Ana')).not.toBeInTheDocument());
    await pick('Helldivers 2');

    expect(await screen.findByRole('checkbox', { name: 'Selecionar Ana' })).not.toBeChecked();
    expect(selectionSummary()).not.toBeInTheDocument();
  });
});
