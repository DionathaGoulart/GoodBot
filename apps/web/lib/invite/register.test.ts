import { DEMO_DURATION_MS } from '@goodbot/shared';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ db: () => ({}) }));

const { inviteOutcome } = await import('./register');

const AGORA = new Date('2026-09-10T12:00:00Z');

function entry(over: Record<string, unknown> = {}) {
  return {
    guildId: '100000000000000001',
    status: 'pending',
    invitedBy: null,
    invitedAt: AGORA,
    approvedAt: null,
    expiresAt: null,
    demoWarnedAt: null,
    demoEndedAt: null,
    leftAt: null,
    note: null,
    createdAt: AGORA,
    updatedAt: AGORA,
    ...over,
  } as never;
}

describe('inviteOutcome', () => {
  it('sem linha no registro', () => {
    expect(inviteOutcome(null, AGORA)).toEqual({ kind: 'desconhecido' });
  });

  it('espelha os status simples', () => {
    expect(inviteOutcome(entry({ status: 'pending' }), AGORA).kind).toBe('pending');
    expect(inviteOutcome(entry({ status: 'approved' }), AGORA).kind).toBe('approved');
    expect(inviteOutcome(entry({ status: 'blocked' }), AGORA).kind).toBe('blocked');
  });

  it('demo dentro do prazo devolve quando acaba', () => {
    const expiresAt = new Date(AGORA.getTime() + DEMO_DURATION_MS);
    expect(inviteOutcome(entry({ status: 'demo', expiresAt }), AGORA)).toEqual({
      kind: 'demo',
      expiresAt,
    });
  });

  it('demo vencida não vira demo de novo', () => {
    const expiresAt = new Date(AGORA.getTime() - 1);
    expect(inviteOutcome(entry({ status: 'demo', expiresAt }), AGORA).kind).toBe('demo-vencida');
  });

  it('demo sem prazo é tratada como vencida, nunca como atendida', () => {
    expect(inviteOutcome(entry({ status: 'demo', expiresAt: null }), AGORA).kind).toBe(
      'demo-vencida',
    );
  });

  it('convite recusado pelo prazo da fila é `expirado`, não `blocked`', () => {
    expect(inviteOutcome(entry({ status: 'expired' }), AGORA).kind).toBe('expirado');
  });

  it('quem gastou a demo e voltou para a fila ouve o porquê, não só "aguardando"', () => {
    // Clicou no link da demo, caiu na fila: a tela precisa explicar a diferença.
    expect(inviteOutcome(entry({ status: 'pending', demoEndedAt: AGORA }), AGORA).kind).toBe(
      'demo-vencida',
    );
    expect(inviteOutcome(entry({ status: 'pending', demoEndedAt: null }), AGORA).kind).toBe(
      'pending',
    );
  });
});
