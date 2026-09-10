import { BOT_INVITE_PERMISSIONS } from '@goodbot/shared';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/env', () => ({
  env: () => ({
    AUTH_URL: 'https://goodbot.dionatha.com.br',
    DISCORD_CLIENT_ID: '123456789012345678',
    DISCORD_CLIENT_SECRET: 'segredo',
  }),
}));

const { inviteAuthorizeUrl, inviteRedirectUri } = await import('./discord');

describe('URL do convite', () => {
  it('manda cada fluxo para o seu próprio callback', () => {
    expect(inviteRedirectUri('invite')).toBe(
      'https://invite.goodbot.dionatha.com.br/api/invite/callback',
    );
    expect(inviteRedirectUri('demo')).toBe(
      'https://demo.goodbot.dionatha.com.br/api/invite/callback',
    );
  });

  it('pede o que o PRD §10 lista, sem Administrator', () => {
    const url = new URL(inviteAuthorizeUrl('demo', 'st4te'));
    expect(url.searchParams.get('permissions')).toBe(BOT_INVITE_PERMISSIONS);
    // `Administrator` é o bit 3.
    expect(BigInt(BOT_INVITE_PERMISSIONS) & (1n << 3n)).toBe(0n);
  });

  it('pede o código de autorização e a instalação em servidor', () => {
    const url = new URL(inviteAuthorizeUrl('invite', 'st4te'));
    expect(url.origin + url.pathname).toBe('https://discord.com/oauth2/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('integration_type')).toBe('0');
    expect(url.searchParams.get('state')).toBe('st4te');
    expect(url.searchParams.get('scope')?.split(' ')).toEqual([
      'bot',
      'applications.commands',
      'identify',
    ]);
    expect(url.searchParams.get('redirect_uri')).toBe(inviteRedirectUri('invite'));
  });
});
