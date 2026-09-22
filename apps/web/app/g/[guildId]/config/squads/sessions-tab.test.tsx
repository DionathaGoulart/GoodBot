// @vitest-environment happy-dom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SessionsTab } from './sessions-tab';

import type { SquadSessionsData } from '@/lib/squad-sessions';
import type { SquadGameRow } from '@/lib/squads';

const NOW = Date.parse('2026-09-22T12:00:00.000Z');

const G1 = '11111111-1111-4111-8111-111111111111';
const G2 = '22222222-2222-4222-8222-222222222222';
const ALFA = '33333333-3333-4333-8333-333333333333';
const GAMA = '44444444-4444-4444-8444-444444444444';

const A = '300000000000000001';
const B = '300000000000000002';
const C = '300000000000000003';

const GAMES: SquadGameRow[] = [
  { id: G1, name: 'Helldivers 2', groupSize: 4, partySize: 4, enabled: true, fields: [] },
  { id: G2, name: 'Deep Rock', groupSize: 4, partySize: 4, enabled: true, fields: [] },
];

/** Uma jogatina de 2 h com Ana e Bia, Caio faltou, e uma cancelada de outro jogo. */
const DATA: SquadSessionsData = {
  sessions: [
    {
      id: 2,
      squadId: GAMA,
      startsAt: '2026-09-21T23:00:00.000Z',
      endsAt: '2026-09-22T05:00:00.000Z',
      goingIds: [A],
      startedAt: null,
      playedAt: null,
      cancelledAt: '2026-09-21T20:00:00.000Z',
    },
    {
      id: 1,
      squadId: ALFA,
      startsAt: '2026-09-20T23:00:00.000Z',
      endsAt: '2026-09-21T05:00:00.000Z',
      goingIds: [A, B, C],
      startedAt: '2026-09-20T23:00:00.000Z',
      playedAt: '2026-09-20T23:00:00.000Z',
      cancelledAt: null,
    },
  ],
  attendance: [
    {
      sessionId: 1,
      userId: A,
      joinedAt: '2026-09-20T23:00:00.000Z',
      leftAt: '2026-09-21T01:00:00.000Z',
      asGuest: false,
    },
    {
      sessionId: 1,
      userId: B,
      joinedAt: '2026-09-20T23:00:00.000Z',
      leftAt: '2026-09-21T01:00:00.000Z',
      asGuest: false,
    },
  ],
  squads: [
    { id: ALFA, gameId: G1, name: 'Alfa' },
    { id: GAMA, gameId: G2, name: 'Gama' },
  ],
  members: {
    [A]: { displayName: 'Ana', username: 'ana', avatarUrl: null },
    [B]: { displayName: 'Bia', username: 'bia', avatarUrl: null },
    [C]: { displayName: 'Caio', username: 'caio', avatarUrl: null },
  },
  membersError: null,
  loadedAt: NOW,
  windowDays: 90,
};

const EMPTY: SquadSessionsData = {
  sessions: [],
  attendance: [],
  squads: [],
  members: {},
  membersError: null,
  loadedAt: NOW,
  windowDays: 90,
};

function renderTab(data: SquadSessionsData = DATA) {
  render(<SessionsTab games={GAMES} data={data} timeZone="America/Sao_Paulo" />);
}

/** O cartão de stat, e não a coluna de mesmo nome na tabela do ranking. */
const tileValue = (label: string) => {
  const tile = screen
    .getAllByText(label)
    .map((element) => element.closest('article'))
    .find((element) => element !== null);
  if (!tile) throw new Error(`cartão ${label} não existe`);
  return tile.querySelector('.stat-value')?.textContent;
};

const panelOf = (title: string) => {
  const panel = screen.getByText(title).closest('section');
  if (!panel) throw new Error(`painel ${title} não existe`);
  return panel;
};

describe('SessionsTab', () => {
  it('resume o que foi marcado, o que rolou e quanto durou', () => {
    renderTab();
    expect(tileValue('MARCADAS')).toBe('2');
    expect(tileValue('ROLARAM')).toBe('1');
    expect(tileValue('HORAS')).toBe('2 h');
    // Ana e Bia cumpriram o VOU, Caio não: 2 de 3.
    expect(tileValue('PRESENÇA')).toBe('67%');
  });

  it('lista as jogatinas da mais recente, com estado e faltas', () => {
    renderTab();
    const rows = within(panelOf('JOGATINAS.LOG')).getAllByRole('row').slice(1);
    expect(within(rows[0] as HTMLElement).getByText('Gama')).toBeTruthy();
    expect(within(rows[0] as HTMLElement).getByText('CANCELADA')).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText('ROLOU')).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText('2/3')).toBeTruthy();
  });

  it('abre o relatório da jogatina ao clicar na linha', () => {
    renderTab();
    fireEvent.click(screen.getByText('Alfa'));
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByText(/Durou 2 h/)).toBeTruthy();
    expect(within(sheet).getByText('FALTARAM')).toBeTruthy();
    expect(within(sheet).getByText('Caio')).toBeTruthy();
  });

  it('mostra as formações, as duplas e o ranking', () => {
    renderTab();
    expect(within(panelOf('FORMACOES.STAT')).getByText('dupla')).toBeTruthy();
    expect(within(panelOf('DUPLAS.MAP')).getByText('Ana e Bia')).toBeTruthy();
    // O grupo exato é outra conta: os dois sozinhos na sala.
    expect(within(panelOf('GRUPOS.RNK')).getByText('Ana e Bia')).toBeTruthy();
    expect(within(panelOf('JOGADORES.RNK')).getByText('Caio')).toBeTruthy();
  });

  it('não quebra sem nenhuma jogatina', () => {
    renderTab(EMPTY);
    expect(tileValue('MARCADAS')).toBe('0');
    expect(tileValue('PRESENÇA')).toBe('—');
    expect(screen.getAllByText(/NADA AQUI/).length).toBeGreaterThan(0);
  });

  it('avisa quando o bot não deu os nomes', () => {
    renderTab({ ...DATA, members: {}, membersError: 'O bot não respondeu.' });
    expect(screen.getByRole('alert').textContent).toContain('ID no lugar do nome');
  });
});
