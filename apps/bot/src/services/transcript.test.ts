import { describe, expect, it } from 'vitest';

import {
  escapeHtml,
  renderTranscriptHtml,
  renderTranscriptText,
  transcriptFileName,
} from './transcript';

import type { TranscriptMessage, TranscriptMeta } from './transcript';

const meta: TranscriptMeta = {
  guildName: 'Servidor <teste>',
  ticketNumber: 42,
  typeName: 'suporte',
  openedBy: 'fulano#0',
  openedAt: new Date('2026-09-06T12:00:00Z'),
  closedBy: 'mod#0',
  closedAt: new Date('2026-09-06T13:00:00Z'),
  closeReason: 'resolvido',
};

const message = (overrides: Partial<TranscriptMessage> = {}): TranscriptMessage => ({
  id: '1',
  authorId: '111111111111111111',
  authorTag: 'fulano',
  bot: false,
  content: 'olá',
  createdAt: new Date('2026-09-06T12:30:00Z'),
  attachments: [],
  embeds: 0,
  ...overrides,
});

describe('escapeHtml', () => {
  it('escapa tudo o que fecharia uma tag ou um atributo', () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;',
    );
    expect(escapeHtml("a & b ' c")).toBe('a &amp; b &#39; c');
  });

  it('escapa o & antes dos outros, sem escape duplo', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });
});

describe('renderTranscriptHtml', () => {
  it('não deixa markup do usuário virar HTML', () => {
    const html = renderTranscriptHtml(meta, [message({ content: '<img src=x onerror=alert(1)>' })]);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('escapa também o nome do servidor e a URL do anexo', () => {
    const html = renderTranscriptHtml(meta, [
      message({ attachments: [{ name: 'a"b.png', url: 'https://x/"onload="1' }] }),
    ]);
    expect(html).toContain('Servidor &lt;teste&gt;');
    expect(html).toContain('https://x/&quot;onload=&quot;1');
  });

  it('é autocontido: nada de script nem de recurso externo', () => {
    const html = renderTranscriptHtml(meta, [message()]);
    expect(html).not.toContain('<script');
    expect(html).not.toMatch(/<link[^>]+href/);
  });

  it('registra a contagem de embeds sem reproduzi-los', () => {
    const html = renderTranscriptHtml(meta, [message({ content: '', embeds: 2 })]);
    expect(html).toContain('[2 embed(s)]');
    expect(html).toContain('[sem texto]');
  });
});

describe('renderTranscriptText', () => {
  it('traz o cabeçalho e uma linha por mensagem', () => {
    const text = renderTranscriptText(meta, [message(), message({ id: '2', content: 'tchau' })]);
    expect(text).toContain('Ticket #42 — Servidor <teste>');
    expect(text).toContain('Motivo: resolvido');
    expect(text).toContain('Mensagens: 2');
    expect(text).toContain('olá');
    expect(text).toContain('tchau');
  });

  it('não escapa nada: o .txt é texto puro', () => {
    const text = renderTranscriptText(meta, [message({ content: '<b>oi</b>' })]);
    expect(text).toContain('<b>oi</b>');
  });
});

describe('transcriptFileName', () => {
  it('usa só o número do ticket, sem nada vindo do usuário', () => {
    expect(transcriptFileName(meta, 'html')).toBe('ticket-42.html');
    expect(transcriptFileName(meta, 'txt')).toBe('ticket-42.txt');
  });
});
