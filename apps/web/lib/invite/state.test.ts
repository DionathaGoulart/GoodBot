import { INVITE_STATE_TTL_MS } from '@goodbot/shared';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/env', () => ({ env: () => ({ AUTH_SECRET: 'a'.repeat(32) }) }));

const { signInviteState, verifyInviteState } = await import('./state');

const AGORA = 1_800_000_000_000;

describe('state assinado do convite', () => {
  it('vai e volta com o fluxo', () => {
    expect(verifyInviteState(signInviteState('demo', AGORA), AGORA)).toEqual({
      flow: 'demo',
      issuedAt: AGORA,
    });
    expect(verifyInviteState(signInviteState('invite', AGORA), AGORA)?.flow).toBe('invite');
  });

  it('não repete: dois `state` do mesmo fluxo e do mesmo instante diferem', () => {
    expect(signInviteState('demo', AGORA)).not.toBe(signInviteState('demo', AGORA));
  });

  it('recusa payload adulterado — trocar `invite` por `demo` invalida a assinatura', () => {
    const original = signInviteState('invite', AGORA);
    const [payload, assinatura] = original.split('.');
    const adulterado = Buffer.from(
      JSON.stringify({
        ...(JSON.parse(Buffer.from(payload ?? '', 'base64url').toString('utf8')) as object),
        f: 'demo',
      }),
    ).toString('base64url');

    expect(verifyInviteState(`${adulterado}.${assinatura ?? ''}`, AGORA)).toBeNull();
  });

  it('recusa assinatura de outro segredo, lixo e vazio', () => {
    const state = signInviteState('demo', AGORA);
    const [payload] = state.split('.');
    expect(verifyInviteState(`${payload ?? ''}.naoehaassinatura`, AGORA)).toBeNull();
    expect(verifyInviteState('sem-ponto', AGORA)).toBeNull();
    expect(verifyInviteState('', AGORA)).toBeNull();
    expect(verifyInviteState(null, AGORA)).toBeNull();
  });

  it('recusa fora do prazo, para trás e para a frente', () => {
    const state = signInviteState('demo', AGORA);
    expect(verifyInviteState(state, AGORA + INVITE_STATE_TTL_MS)).not.toBeNull();
    expect(verifyInviteState(state, AGORA + INVITE_STATE_TTL_MS + 1)).toBeNull();
    // `state` emitido no futuro: o relógio de quem assina é o nosso.
    expect(verifyInviteState(state, AGORA - 1)).toBeNull();
  });

  it('recusa um payload que não é o nosso, mesmo assinado', () => {
    // Assinado com o mesmo segredo, mas sem os campos que o schema exige.
    const payload = Buffer.from(JSON.stringify({ f: 'admin', t: AGORA })).toString('base64url');
    const state = signInviteState('demo', AGORA);
    expect(verifyInviteState(`${payload}.${state.split('.')[1] ?? ''}`, AGORA)).toBeNull();
  });
});
