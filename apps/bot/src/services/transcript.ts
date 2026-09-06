import { AttachmentBuilder } from 'discord.js';

import type { Ticket } from '@cobot/db';
import type { GuildTextBasedChannel, Message } from 'discord.js';

/** Teto de mensagens lidas de um ticket: acima disso o HTML fica impraticável. */
export const MAX_TRANSCRIPT_MESSAGES = 1_000;
/** A API do Discord entrega no máximo 100 mensagens por página. */
const PAGE_SIZE = 100;

export interface TranscriptAttachment {
  name: string;
  url: string;
}

/** Mensagem já achatada: o transcript não depende de objetos do discord.js. */
export interface TranscriptMessage {
  id: string;
  authorId: string;
  authorTag: string;
  bot: boolean;
  content: string;
  createdAt: Date;
  attachments: TranscriptAttachment[];
  /** Embeds não são reproduzidos; o transcript só registra quantos havia. */
  embeds: number;
}

export interface TranscriptMeta {
  guildName: string;
  ticketNumber: number;
  typeName: string | null;
  openedBy: string;
  openedAt: Date;
  closedBy: string | null;
  closedAt: Date;
  closeReason: string | null;
}

/**
 * Todo texto que entra no HTML passa por aqui. O conteúdo é escrito por
 * usuários: sem escape, um `<script>` numa mensagem viraria script no
 * transcript aberto pelo moderador.
 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatDate(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: timezone,
  }).format(date);
}

/** Nome do arquivo, sem nada que possa virar caminho. */
export function transcriptFileName(meta: TranscriptMeta, extension: 'html' | 'txt'): string {
  return `ticket-${meta.ticketNumber}.${extension}`;
}

/**
 * HTML autocontido (styleguide §9: radius 0, borda 2px, mono, crimson): o
 * arquivo é aberto do anexo do Discord, então não pode buscar nada na rede.
 */
export function renderTranscriptHtml(
  meta: TranscriptMeta,
  messages: readonly TranscriptMessage[],
  timezone = 'America/Sao_Paulo',
): string {
  const title = `Ticket #${meta.ticketNumber} · ${meta.guildName}`;
  const rows = messages
    .map((message) => {
      const attachments = message.attachments
        .map(
          (file) =>
            `<a class="file" href="${escapeHtml(file.url)}">${escapeHtml(file.name)}</a>`,
        )
        .join('');
      const embeds =
        message.embeds > 0 ? `<div class="note">[${message.embeds} embed(s)]</div>` : '';
      const body = message.content
        ? `<div class="body">${escapeHtml(message.content)}</div>`
        : '<div class="body note">[sem texto]</div>';
      return [
        '<article class="msg">',
        '<header>',
        `<span class="author">${escapeHtml(message.authorTag)}</span>`,
        message.bot ? '<span class="badge">BOT</span>' : '',
        `<span class="id">${escapeHtml(message.authorId)}</span>`,
        `<time>${escapeHtml(formatDate(message.createdAt, timezone))}</time>`,
        '</header>',
        body,
        attachments ? `<div class="files">${attachments}</div>` : '',
        embeds,
        '</article>',
      ].join('');
    })
    .join('\n');

  const metaRows = [
    { key: 'Servidor', value: meta.guildName },
    { key: 'Tipo', value: meta.typeName ?? '—' },
    { key: 'Aberto por', value: meta.openedBy },
    { key: 'Aberto em', value: formatDate(meta.openedAt, timezone) },
    { key: 'Fechado por', value: meta.closedBy ?? '—' },
    { key: 'Fechado em', value: formatDate(meta.closedAt, timezone) },
    { key: 'Motivo', value: meta.closeReason ?? '—' },
    { key: 'Mensagens', value: String(messages.length) },
  ]
    .map((row) => `<div><dt>${escapeHtml(row.key)}</dt><dd>${escapeHtml(row.value)}</dd></div>`)
    .join('');

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root { color-scheme: light; --ink: #1a0a0a; --bg: #f2efe7; --raised: #ffffff; --accent: #dc143c; }
* { box-sizing: border-box; }
body { margin: 0; padding: 24px; background: var(--bg); color: var(--ink);
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px; line-height: 1.5; }
main { max-width: 900px; margin: 0 auto; }
h1 { font-size: 18px; text-transform: uppercase; letter-spacing: 0.04em; margin: 0 0 16px; }
h1::before { content: '> '; color: var(--accent); }
dl { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 16px; margin: 0 0 24px;
  background: var(--raised); border: 2px solid var(--ink); padding: 12px; }
dl > div { display: flex; gap: 8px; }
dt { text-transform: uppercase; opacity: 0.6; }
dd { margin: 0; font-weight: 700; word-break: break-word; }
.msg { background: var(--raised); border: 2px solid var(--ink); padding: 10px 12px;
  margin-bottom: 8px; }
.msg header { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px;
  border-bottom: 2px solid var(--ink); padding-bottom: 6px; margin-bottom: 6px; }
.author { font-weight: 700; color: var(--accent); }
.badge { border: 2px solid var(--ink); padding: 0 4px; font-size: 10px; text-transform: uppercase; }
.id, time { opacity: 0.5; font-size: 11px; }
time { margin-left: auto; }
.body { white-space: pre-wrap; word-break: break-word; }
.note { opacity: 0.5; }
.files { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 6px; }
.file { border: 2px solid var(--ink); padding: 1px 6px; text-decoration: none; color: var(--ink); }
footer { margin-top: 24px; opacity: 0.5; text-transform: uppercase; font-size: 11px; }
</style>
</head>
<body>
<main>
<h1>${escapeHtml(title)}</h1>
<dl>${metaRows}</dl>
${rows || '<p class="note">Nenhuma mensagem.</p>'}
<footer>CoBot · transcript gerado em ${escapeHtml(formatDate(new Date(), timezone))}</footer>
</main>
</body>
</html>`;
}

/** Versão `.txt`, para quem só quer ler ou grepar. */
export function renderTranscriptText(
  meta: TranscriptMeta,
  messages: readonly TranscriptMessage[],
  timezone = 'America/Sao_Paulo',
): string {
  const header = [
    `Ticket #${meta.ticketNumber} — ${meta.guildName}`,
    `Tipo: ${meta.typeName ?? '—'}`,
    `Aberto por: ${meta.openedBy} em ${formatDate(meta.openedAt, timezone)}`,
    `Fechado por: ${meta.closedBy ?? '—'} em ${formatDate(meta.closedAt, timezone)}`,
    `Motivo: ${meta.closeReason ?? '—'}`,
    `Mensagens: ${messages.length}`,
    '',
    '─'.repeat(60),
    '',
  ].join('\n');

  const body = messages
    .map((message) => {
      const lines = [
        `[${formatDate(message.createdAt, timezone)}] ${message.authorTag} (${message.authorId})`,
        message.content || '[sem texto]',
      ];
      for (const file of message.attachments) lines.push(`  anexo: ${file.name} — ${file.url}`);
      if (message.embeds > 0) lines.push(`  [${message.embeds} embed(s)]`);
      return lines.join('\n');
    })
    .join('\n\n');

  return `${header}${body}\n`;
}

function toTranscriptMessage(message: Message): TranscriptMessage {
  return {
    id: message.id,
    authorId: message.author.id,
    authorTag: message.author.tag,
    bot: message.author.bot,
    content: message.content,
    createdAt: message.createdAt,
    attachments: [...message.attachments.values()].map((file) => ({
      name: file.name,
      url: file.url,
    })),
    embeds: message.embeds.length,
  };
}

/** Lê o canal do mais antigo para o mais novo, paginando pelo `after`. */
export async function collectMessages(
  channel: GuildTextBasedChannel,
  limit = MAX_TRANSCRIPT_MESSAGES,
): Promise<TranscriptMessage[]> {
  const collected: TranscriptMessage[] = [];
  let after = '0';

  while (collected.length < limit) {
    const page = await channel.messages.fetch({ limit: PAGE_SIZE, after });
    if (page.size === 0) break;
    // `fetch` devolve do mais novo para o mais antigo.
    const ordered = [...page.values()].reverse();
    for (const message of ordered) {
      collected.push(toTranscriptMessage(message));
      after = message.id;
    }
    if (page.size < PAGE_SIZE) break;
  }

  return collected.slice(0, limit);
}

export interface TranscriptFiles {
  files: AttachmentBuilder[];
  html: string;
  text: string;
}

/** Anexos prontos para `channel.send`, no formato escolhido na config. */
export function buildTranscriptFiles(
  meta: TranscriptMeta,
  messages: readonly TranscriptMessage[],
  options: { format: 'html' | 'txt'; timezone?: string },
): TranscriptFiles {
  const html = renderTranscriptHtml(meta, messages, options.timezone);
  const text = renderTranscriptText(meta, messages, options.timezone);
  const chosen = options.format === 'txt' ? text : html;
  const file = new AttachmentBuilder(Buffer.from(chosen, 'utf8'), {
    name: transcriptFileName(meta, options.format === 'txt' ? 'txt' : 'html'),
  });
  return { files: [file], html, text };
}

/** Metadados do transcript a partir da linha já fechada de `tickets`. */
export function transcriptMeta(
  ticket: Ticket,
  input: { guildName: string; typeName: string | null; openedBy: string; closedBy: string | null },
): TranscriptMeta {
  return {
    guildName: input.guildName,
    ticketNumber: ticket.number,
    typeName: input.typeName,
    openedBy: input.openedBy,
    openedAt: ticket.openedAt,
    closedBy: input.closedBy,
    closedAt: ticket.closedAt ?? new Date(),
    closeReason: ticket.closeReason,
  };
}
