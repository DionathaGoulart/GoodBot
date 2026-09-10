import { BROADCAST_CONFIRMATION, InternalApiError } from '@goodbot/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminGuildRow } from './admin';
import type * as db from '@goodbot/db';
import type * as react from 'react';

const OWNER = '100000000000000001';
const GUILD_ID = '200000000000000002';

const setGuildStatus = vi.fn();
const leaveGuild = vi.fn();
const broadcastApi = vi.fn();

vi.mock('server-only', () => ({}));
vi.mock('./db', () => ({ db: () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof react>('react');
  return { ...actual, cache: <T,>(fn: T) => fn };
});
vi.mock('@goodbot/db', async () => {
  const actual = await vi.importActual<typeof db>('@goodbot/db');
  return {
    ...actual,
    listGuildRegistry: () => Promise.resolve([]),
    usageByGuild: () => Promise.resolve([]),
    setGuildStatus: (...args: unknown[]) => setGuildStatus(...args),
  };
});
vi.mock('./internal-api', () => ({
  internalApi: () => ({ admin: { leaveGuild, broadcast: broadcastApi } }),
}));
vi.mock('./auth/owner', () => ({
  requireBotOwner: () =>
    Promise.resolve({ user: { id: OWNER, name: 'dono#1', image: null } }),
}));

const { approveGuild, blockGuild, broadcast, queueOf } = await import('./admin');

function row(overrides: Partial<AdminGuildRow>): AdminGuildRow {
  return {
    guildId: GUILD_ID,
    status: 'approved',
    served: true,
    invitedBy: null,
    invitedAt: '2026-01-01T00:00:00.000Z',
    approvedAt: null,
    expiresAt: null,
    demoSpent: false,
    leftAt: null,
    note: null,
    live: null,
    usage: { commands: 0, messages: 0 },
    ...overrides,
  };
}

function form(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
  setGuildStatus.mockResolvedValue({ guildId: GUILD_ID });
  leaveGuild.mockResolvedValue({ guildId: GUILD_ID, name: 'Servidor', announced: true });
});

describe('queueOf', () => {
  it('junta quem espera aprovação e quem já gastou a demonstração', () => {
    const fila = queueOf([
      row({ status: 'pending', served: false }),
      row({ guildId: '3', status: 'demo', demoSpent: true, served: false }),
      // Demo correndo é servidor sendo atendido agora: não é decisão pendente.
      row({ guildId: '4', status: 'demo', demoSpent: false }),
      row({ guildId: '5', status: 'approved' }),
      row({ guildId: '6', status: 'blocked', served: false }),
    ]);

    expect(fila.map((entry) => entry.guildId)).toEqual([GUILD_ID, '3']);
  });
});

describe('approveGuild', () => {
  it('aprova e apaga o prazo da demo', async () => {
    const result = await approveGuild(form({ guildId: GUILD_ID }));

    expect(result.ok).toBe(true);
    // `expiresAt: null` não é detalhe: uma data velha aqui faria o
    // `isGuildServed` continuar contando um relógio que não existe mais.
    expect(setGuildStatus).toHaveBeenCalledWith({}, GUILD_ID, {
      status: 'approved',
      expiresAt: null,
      note: null,
    });
  });

  it('recusa um servidor que não está no registro', async () => {
    setGuildStatus.mockResolvedValue(null);
    const result = await approveGuild(form({ guildId: GUILD_ID }));

    expect(result.ok).toBe(false);
  });
});

describe('blockGuild', () => {
  it('grava o bloqueio antes de pedir a saída', async () => {
    const ordem: string[] = [];
    setGuildStatus.mockImplementation(() => {
      ordem.push('banco');
      return Promise.resolve({ guildId: GUILD_ID });
    });
    leaveGuild.mockImplementation(() => {
      ordem.push('bot');
      return Promise.resolve({ guildId: GUILD_ID, name: 'Servidor', announced: true });
    });

    const result = await blockGuild(form({ guildId: GUILD_ID, note: 'spam' }));

    expect(result.ok).toBe(true);
    expect(ordem).toEqual(['banco', 'bot']);
    expect(setGuildStatus).toHaveBeenCalledWith({}, GUILD_ID, {
      status: 'blocked',
      note: 'spam',
    });
    expect(leaveGuild).toHaveBeenCalledWith(GUILD_ID, {
      actorId: OWNER,
      announce: true,
      reason: 'spam',
    });
  });

  it('continua bloqueado quando o bot não consegue sair', async () => {
    leaveGuild.mockRejectedValue(
      new InternalApiError('O bot não está neste servidor.', { status: 404, code: 'NOT_FOUND' }),
    );

    const result = await blockGuild(form({ guildId: GUILD_ID }));

    // O banco é quem decide; a saída é a metade tolerante a falha. Devolver
    // `ok: false` aqui faria parecer que o bloqueio não valeu — e ele valeu.
    expect(result.ok).toBe(true);
    expect(result.message).toContain('Bloqueado');
    expect(setGuildStatus).toHaveBeenCalled();
  });
});

describe('broadcast', () => {
  it('não chama o bot sem a palavra de confirmação', async () => {
    const result = await broadcast(form({ title: 'Aviso', message: 'Texto', confirm: 'sim' }));

    expect(result.ok).toBe(false);
    expect(broadcastApi).not.toHaveBeenCalled();
  });

  it('o ensaio dispensa a palavra porque não envia nada', async () => {
    broadcastApi.mockResolvedValue({
      dryRun: true,
      total: 2,
      delivered: 0,
      failed: 0,
      targets: [],
    });

    const result = await broadcast(
      form({ title: 'Aviso', message: 'Texto', dryRun: 'true', confirm: '' }),
    );

    expect(result.ok).toBe(true);
    expect(broadcastApi).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true, confirm: BROADCAST_CONFIRMATION }),
    );
  });

  it('recusa título ou mensagem vazios antes de falar com o bot', async () => {
    const result = await broadcast(
      form({ title: '   ', message: 'Texto', confirm: BROADCAST_CONFIRMATION }),
    );

    expect(result.ok).toBe(false);
    expect(broadcastApi).not.toHaveBeenCalled();
  });
});
