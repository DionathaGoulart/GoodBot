import { INVITE_NOTICE_KINDS } from '@goodbot/shared';
import { describe, expect, it, vi } from 'vitest';

import { inviterNoticeEmbed, sendInviterDm } from './inviter-dm';

import type { InviteNoticeKind } from '@goodbot/shared';
import type { Client } from 'discord.js';

const URLS = { invite: 'https://invite.goodbot.example/', panel: 'https://goodbot.example/' };

function descricao(kind: InviteNoticeKind, extra: Record<string, unknown> = {}): string {
  return (
    inviterNoticeEmbed({ kind, guildName: 'Servidor de teste', urls: URLS, ...extra }).data
      .description ?? ''
  );
}

describe('inviterNoticeEmbed', () => {
  it('todo aviso tem título, descrição e cita o servidor', () => {
    for (const kind of INVITE_NOTICE_KINDS) {
      const embed = inviterNoticeEmbed({ kind, guildName: 'Servidor de teste', urls: URLS });
      expect(embed.data.title, kind).toBeTruthy();
      expect(embed.data.description, kind).toContain('Servidor de teste');
    }
  });

  it('sem nome do servidor (bot já saiu), não inventa um', () => {
    for (const kind of INVITE_NOTICE_KINDS) {
      const texto = inviterNoticeEmbed({ kind, guildName: null, urls: URLS }).data.description ?? '';
      expect(texto, kind).toContain('seu servidor');
    }
  });

  it('a entrada da demo diz o prazo, que não renova e como ficar de vez', () => {
    const texto = descricao('demo-started', {
      expiresAt: new Date('2026-09-10T13:00:00Z'),
    });
    expect(texto).toContain('uma vez por servidor');
    expect(texto).toContain('nada é apagado');
    expect(texto).toContain(URLS.invite);
  });

  it('a entrada na fila explica o silêncio e o prazo da recusa', () => {
    const texto = descricao('queued');
    // O sintoma que gera dúvida ("instalei errado?") tem de ser nomeado.
    expect(texto).toContain('não está funcionando');
    expect(texto).toContain('7 dias');
    expect(texto).toContain('Convidar de novo continua valendo');
  });

  it('a recusa por inatividade se diferencia de bloqueio', () => {
    const texto = descricao('expired');
    expect(texto).toContain('não é um bloqueio');
    expect(texto).toContain(URLS.invite);
  });

  it('o bloqueio leva o motivo quando o dono do bot escreveu um', () => {
    expect(descricao('blocked', { reason: 'servidor de divulgação' })).toContain(
      'servidor de divulgação',
    );
    expect(descricao('blocked')).toContain('não registrou um motivo');
  });

  it('a aprovação manda para o painel', () => {
    expect(descricao('approved')).toContain(URLS.panel);
  });

  it('sem AUTH_URL o aviso sai sem link, não sai quebrado', () => {
    for (const kind of INVITE_NOTICE_KINDS) {
      const texto =
        inviterNoticeEmbed({ kind, guildName: 'Servidor de teste' }).data.description ?? '';
      expect(texto, kind).not.toContain('http');
      expect(texto, kind).not.toContain('undefined');
    }
  });
});

describe('sendInviterDm', () => {
  function client(overrides: Record<string, unknown> = {}) {
    const send = vi.fn(() => Promise.resolve({ id: 'dm-1' }));
    const fetch = vi.fn(() => Promise.resolve({ bot: false, send }));
    return { send, fetch, client: { users: { fetch, ...overrides } } as unknown as Client };
  }

  it('sem quem convidar (linha semeada pelo GUILD_IDS), não tenta nada', async () => {
    const { client: c, fetch } = client();
    await expect(sendInviterDm(c, null, { kind: 'queued' })).resolves.toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('DM fechada é resultado normal, não erro', async () => {
    const { client: c, fetch } = client();
    fetch.mockRejectedValue(new Error('Cannot send messages to this user'));
    await expect(sendInviterDm(c, '700000000000000000', { kind: 'queued' })).resolves.toBe(false);
  });

  it('não manda DM para bot', async () => {
    const { client: c, send, fetch } = client();
    fetch.mockResolvedValue({ bot: true, send });
    await expect(sendInviterDm(c, '700000000000000000', { kind: 'queued' })).resolves.toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('entrega o embed do aviso pedido', async () => {
    const { client: c, send } = client();
    await expect(sendInviterDm(c, '700000000000000000', { kind: 'approved' })).resolves.toBe(true);
    expect(send).toHaveBeenCalledOnce();
  });
});
