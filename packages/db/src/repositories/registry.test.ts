import { describe, expect, it } from 'vitest';

import { isGuildServed, type GuildRegistryEntry } from './registry';

const AGORA = new Date('2026-01-01T12:00:00Z');

function entry(overrides: Partial<GuildRegistryEntry>): GuildRegistryEntry {
  return {
    guildId: '111111111111111111',
    status: 'pending',
    invitedBy: null,
    invitedAt: AGORA,
    approvedAt: null,
    expiresAt: null,
    leftAt: null,
    note: null,
    createdAt: AGORA,
    updatedAt: AGORA,
    ...overrides,
  };
}

describe('isGuildServed', () => {
  it('atende quem foi aprovado', () => {
    expect(isGuildServed(entry({ status: 'approved' }), AGORA)).toBe(true);
  });

  it('não atende quem espera aprovação', () => {
    expect(isGuildServed(entry({ status: 'pending' }), AGORA)).toBe(false);
  });

  it('não atende quem foi bloqueado', () => {
    expect(isGuildServed(entry({ status: 'blocked' }), AGORA)).toBe(false);
  });

  it('atende a demo dentro do prazo', () => {
    const expiresAt = new Date(AGORA.getTime() + 60_000);
    expect(isGuildServed(entry({ status: 'demo', expiresAt }), AGORA)).toBe(true);
  });

  it('para de atender a demo no instante em que ela vence', () => {
    // O job de expiração pode estar atrasado; a conta não pode depender dele.
    expect(isGuildServed(entry({ status: 'demo', expiresAt: AGORA }), AGORA)).toBe(false);
  });

  it('não atende demo sem prazo — linha corrompida não vira acesso vitalício', () => {
    expect(isGuildServed(entry({ status: 'demo', expiresAt: null }), AGORA)).toBe(false);
  });

  it('não atende guild sem linha no registro', () => {
    expect(isGuildServed(undefined, AGORA)).toBe(false);
  });
});
