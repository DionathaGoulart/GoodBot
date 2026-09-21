import { describe, expect, it } from 'vitest';

import {
  classifyHost,
  hostForSite,
  hostOfInviteFlow,
  inviteFlowOf,
  siteFromHeaders,
  SITE_HOST_HEADER,
} from './hosts';

function headers(values: Record<string, string>) {
  return { get: (name: string) => values[name.toLowerCase()] ?? null };
}

describe('classifyHost', () => {
  it('reconhece os três subdomínios em qualquer domínio', () => {
    expect(classifyHost('invite.goodbot.example.com')).toBe('invite');
    expect(classifyHost('demo.goodbot.example.com')).toBe('demo');
    expect(classifyHost('admin.goodbot.example.com')).toBe('admin');
    expect(classifyHost('invite.goodbot.com.br')).toBe('invite');
  });

  it('funciona em dev, onde os hosts têm porta e um rótulo só', () => {
    expect(classifyHost('invite.localhost:3000')).toBe('invite');
    expect(classifyHost('demo.localhost:3000')).toBe('demo');
    expect(classifyHost('localhost:3000')).toBe('app');
  });

  it('ignora caixa', () => {
    expect(classifyHost('DEMO.Goodbot.Dionatha.com.br')).toBe('demo');
  });

  it('cai em `app` no host do painel, num preview e sem host', () => {
    expect(classifyHost('goodbot.example.com')).toBe('app');
    expect(classifyHost('goodbot-git-main.vercel.app')).toBe('app');
    expect(classifyHost(null)).toBe('app');
    expect(classifyHost('')).toBe('app');
  });

  it('não confunde um rótulo que só começa igual', () => {
    expect(classifyHost('invitex.goodbot.example.com')).toBe('app');
    expect(classifyHost('goodbot.invite.com')).toBe('app');
  });
});

describe('siteFromHeaders', () => {
  it('prefere o que o proxy resolveu', () => {
    expect(siteFromHeaders(headers({ [SITE_HOST_HEADER]: 'demo', host: 'goodbot.com' }))).toBe(
      'demo',
    );
  });

  it('recai no header Host quando o proxy não passou por ali', () => {
    expect(siteFromHeaders(headers({ host: 'invite.goodbot.com' }))).toBe('invite');
  });

  it('descarta um valor inventado no header', () => {
    expect(siteFromHeaders(headers({ [SITE_HOST_HEADER]: 'root', host: 'goodbot.com' }))).toBe(
      'app',
    );
  });
});

describe('fluxo ↔ host', () => {
  it('vai e volta', () => {
    expect(inviteFlowOf('invite')).toBe('invite');
    expect(inviteFlowOf('demo')).toBe('demo');
    expect(inviteFlowOf('app')).toBeNull();
    expect(inviteFlowOf('admin')).toBeNull();
    expect(hostOfInviteFlow('invite')).toBe('invite');
    expect(hostOfInviteFlow('demo')).toBe('demo');
  });
});

describe('hostForSite', () => {
  it('põe o rótulo do destino na frente do host do painel', () => {
    expect(hostForSite('goodbot.example.com', 'admin')).toBe(
      'admin.goodbot.example.com',
    );
    expect(hostForSite('goodbot.example.com', 'invite')).toBe(
      'invite.goodbot.example.com',
    );
  });

  it('volta ao painel tirando o rótulo — é assim que o `admin.` manda ao login', () => {
    expect(hostForSite('admin.goodbot.example.com', 'app')).toBe('goodbot.example.com');
    expect(hostForSite('demo.goodbot.example.com', 'app')).toBe('goodbot.example.com');
  });

  it('troca um rótulo pelo outro sem empilhar', () => {
    expect(hostForSite('demo.goodbot.example.com', 'admin')).toBe(
      'admin.goodbot.example.com',
    );
  });

  it('preserva a porta, que é o que faz o dev funcionar', () => {
    expect(hostForSite('localhost:3000', 'admin')).toBe('admin.localhost:3000');
    expect(hostForSite('admin.localhost:3000', 'app')).toBe('localhost:3000');
  });

  it('não come um rótulo que não é nosso', () => {
    // `goodbot` não está em PREFIXES: tirá-lo mandaria para outro domínio.
    expect(hostForSite('goodbot.example.com', 'app')).toBe('goodbot.example.com');
  });
});
