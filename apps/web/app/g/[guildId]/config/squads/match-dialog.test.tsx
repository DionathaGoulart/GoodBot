// @vitest-environment happy-dom
import {
  DEFAULT_SQUAD_BLOCKS,
  pairKey,
  type SquadManualCheck,
  type SquadManualIssue,
} from '@goodbot/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { describeManualIssue } from '@/lib/squad-labels';
import { TEST_GUILD_ID } from '@/vitest.setup';

import { MatchDialog } from './match-dialog';

const checkManualSquadMatchAction = vi.fn();
const proposeManualSquadAction = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock('@/app/actions/squads', () => ({
  checkManualSquadMatchAction: (guildId: string, formData: FormData) =>
    checkManualSquadMatchAction(guildId, formData),
  proposeManualSquadAction: (guildId: string, formData: FormData) =>
    proposeManualSquadAction(guildId, formData),
}));

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

const GAME = '11111111-1111-4111-8111-111111111111';
const ANA = '300000000000000001';
const BIA = '300000000000000002';
const NAMES: Record<string, string> = { [ANA]: 'Ana', [BIA]: 'Bia' };
const nameOf = (userId: string) => NAMES[userId] ?? userId;

const describeIssue = (issue: SquadManualIssue) =>
  describeManualIssue(issue, {
    nameOf,
    groupSize: 4,
    partySize: 4,
    maxSquadsPerUser: 2,
    cooldownDays: 7,
    fieldLabel: (key) => key,
    squadOf: (userId) => (userId === BIA ? 'Alfa' : null),
  });

function check(overrides: Partial<SquadManualCheck> = {}): SquadManualCheck {
  return {
    gameId: GAME,
    userIds: [ANA, BIA],
    pairs: [
      { userIds: [ANA, BIA], score: 7, hardOk: true, commonCells: 2, cooldown: false, hardConflicts: [] },
    ],
    score: 7,
    commonMask: 1,
    slot: { day: 6, block: 2 },
    blocks: [],
    warnings: [],
    ...overrides,
  };
}

const NOT_SEARCHING: SquadManualIssue = {
  key: `NOT_SEARCHING:${ANA}`,
  code: 'NOT_SEARCHING',
  severity: 'warning',
  userIds: [ANA],
};
const PAIR_COOLDOWN: SquadManualIssue = {
  key: `PAIR_COOLDOWN:${pairKey(ANA, BIA)}`,
  code: 'PAIR_COOLDOWN',
  severity: 'warning',
  userIds: [ANA, BIA],
};
const AT_SQUAD_LIMIT: SquadManualIssue = {
  key: `AT_SQUAD_LIMIT:${BIA}`,
  code: 'AT_SQUAD_LIMIT',
  severity: 'warning',
  userIds: [BIA],
};

function sentPayload(mock: ReturnType<typeof vi.fn>, call = 0): unknown {
  const [guildId, formData] = mock.mock.calls[call] as [string, FormData];
  expect(guildId).toBe(TEST_GUILD_ID);
  return JSON.parse(String(formData.get('payload'))) as unknown;
}

function renderDialog(onClose = vi.fn()) {
  render(
    <MatchDialog
      open
      gameId={GAME}
      userIds={[ANA, BIA]}
      blocks={DEFAULT_SQUAD_BLOCKS}
      nameOf={nameOf}
      describe={describeIssue}
      onClose={onClose}
    />,
  );
  return onClose;
}

const confirmButton = () => screen.getByRole('button', { name: 'CONFIRMAR' });
const ackBox = () => screen.findByRole('checkbox', { name: 'Li os avisos e quero seguir mesmo assim' });

describe('MatchDialog', { timeout: 20_000 }, () => {
  beforeEach(() => {
    checkManualSquadMatchAction.mockReset();
    proposeManualSquadAction.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  it('revisa pelo bot ao abrir e mostra horário em comum e duplas', async () => {
    checkManualSquadMatchAction.mockResolvedValue({ ok: true, check: check() });
    renderDialog();

    expect(await screen.findByText('SÁB · NOITE 18H ÀS 24H')).toBeInTheDocument();
    expect(sentPayload(checkManualSquadMatchAction)).toEqual({ gameId: GAME, userIds: [ANA, BIA] });
    expect(screen.getByText('Ana + Bia')).toBeInTheDocument();
    expect(confirmButton()).toBeEnabled();
  });

  it('bloqueio desabilita confirmar, com o texto de quem entrou num squad depois', async () => {
    checkManualSquadMatchAction.mockResolvedValue({
      ok: true,
      check: check({
        blocks: [
          { key: `IN_SQUAD_IN_GAME:${BIA}`, code: 'IN_SQUAD_IN_GAME', severity: 'block', userIds: [BIA] },
        ],
        warnings: [NOT_SEARCHING],
      }),
    });
    renderDialog();

    expect(
      await screen.findByText('Bia já está num squad deste jogo (Alfa). Tire do squad antes de propor.'),
    ).toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();
    // Com bloqueio não há o que confirmar: a caixa de "li os avisos" nem aparece.
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('aviso exige marcar que leu, e confirmar manda todas as keys exibidas', async () => {
    checkManualSquadMatchAction.mockResolvedValue({
      ok: true,
      check: check({ warnings: [NOT_SEARCHING, PAIR_COOLDOWN] }),
    });
    proposeManualSquadAction.mockResolvedValue({ ok: true, message: 'Proposta aberta.' });
    const onClose = renderDialog();

    const ack = await ackBox();
    expect(confirmButton()).toBeDisabled();
    fireEvent.click(ack);
    expect(confirmButton()).toBeEnabled();
    fireEvent.click(confirmButton());

    await waitFor(() => expect(onClose).toHaveBeenCalledWith(true));
    expect(sentPayload(proposeManualSquadAction)).toEqual({
      gameId: GAME,
      userIds: [ANA, BIA],
      confirmedWarnings: [NOT_SEARCHING.key, PAIR_COOLDOWN.key],
    });
    expect(toastSuccess).toHaveBeenCalledTimes(1);
  });

  it('revisão velha mostra o aviso, refaz o check e desmarca a caixa', async () => {
    checkManualSquadMatchAction
      .mockResolvedValueOnce({ ok: true, check: check({ warnings: [NOT_SEARCHING] }) })
      .mockResolvedValueOnce({
        ok: true,
        check: check({ warnings: [NOT_SEARCHING, AT_SQUAD_LIMIT] }),
      });
    proposeManualSquadAction.mockResolvedValue({
      ok: false,
      stale: true,
      message: 'Há avisos que não foram confirmados. Revise de novo.',
    });
    const onClose = renderDialog();

    fireEvent.click(await ackBox());
    fireEvent.click(confirmButton());

    expect(await screen.findByText('ALGO MUDOU DESDE A REVISÃO. CONFIRA DE NOVO.')).toBeInTheDocument();
    expect(
      await screen.findByText(/^Bia já está no máximo de squads do servidor \(2\)\./),
    ).toBeInTheDocument();
    expect(checkManualSquadMatchAction).toHaveBeenCalledTimes(2);
    expect(await ackBox()).not.toBeChecked();
    expect(confirmButton()).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('erro do bot na revisão aparece e não deixa confirmar', async () => {
    checkManualSquadMatchAction.mockResolvedValue({ ok: false, message: 'O bot não respondeu.' });
    renderDialog();

    expect(await screen.findByText('O bot não respondeu.')).toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();
  });
});
