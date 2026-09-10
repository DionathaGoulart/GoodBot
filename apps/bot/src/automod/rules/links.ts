import type { MessageRule } from '../types';

/** URLs com esquema, mais domínios "nus" (`exemplo.com/x`, `www.exemplo.com`). */
const URL_PATTERN =
  /\b(?:https?:\/\/|www\.)[^\s<>"'`]+|\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,24}(?:\/[^\s<>"'`]*)?/gi;

/**
 * Sem esquema, `foto.png` tem a mesma forma de um domínio. A lista evita que
 * falar de um arquivo no chat seja tratado como link.
 */
const FILE_EXTENSIONS = new Set([
  'bat',
  'bmp',
  'css',
  'csv',
  'doc',
  'docx',
  'exe',
  'gif',
  'gz',
  'html',
  'jpeg',
  'jpg',
  'js',
  'json',
  'log',
  'md',
  'mov',
  'mp3',
  'mp4',
  'pdf',
  'png',
  'ppt',
  'pptx',
  'psd',
  'py',
  'rar',
  'sh',
  'sql',
  'svg',
  'ts',
  'txt',
  'wav',
  'webp',
  'xls',
  'xlsx',
  'xml',
  'yaml',
  'yml',
  'zip',
]);

/** `arquivo.png` sem esquema e sem caminho é arquivo, não domínio. */
function looksLikeFile(raw: string, host: string): boolean {
  if (/^https?:\/\//i.test(raw) || raw.includes('/')) return false;
  const tld = host.slice(host.lastIndexOf('.') + 1);
  return FILE_EXTENSIONS.has(tld);
}

/** `discord.gg/x`, `discord.com/invite/x`, `discordapp.com/invite/x`. */
const INVITE_PATTERN = /\b(?:discord\.(?:gg|me|li)|(?:discord(?:app)?\.com)\/invite)\/[\w-]+/i;

/** Domínio de uma URL, sem porta, sem `www.` e sem credenciais. */
export function extractHost(raw: string): string | null {
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  try {
    const host = new URL(withScheme).hostname.toLowerCase();
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch {
    return null;
  }
}

export function extractHosts(content: string): string[] {
  const hosts: string[] = [];
  for (const match of content.matchAll(URL_PATTERN)) {
    const host = extractHost(match[0]);
    if (!host || looksLikeFile(match[0], host)) continue;
    if (!hosts.includes(host)) hosts.push(host);
  }
  return hosts;
}

/** `exemplo.com` na allowlist libera `cdn.exemplo.com`, mas não `exemplo.com.br`. */
export function isAllowedHost(host: string, allowed: readonly string[]): boolean {
  return allowed.some((entry) => {
    const domain = entry.startsWith('www.') ? entry.slice(4) : entry;
    return host === domain || host.endsWith(`.${domain}`);
  });
}

export const linksRule: MessageRule<'links'> = {
  type: 'links',
  check({ ctx, config }) {
    if (config.allowedChannelIds.includes(ctx.channelId)) return null;

    const invite = INVITE_PATTERN.exec(ctx.content);
    if (config.blockInvites && invite) {
      return { reason: 'Convite de servidor não permitido.', detail: invite[0] };
    }
    // `invitesOnly`: links comuns passam, só o convite acima é bloqueado.
    if (config.invitesOnly) return null;

    const blocked = extractHosts(ctx.content).filter(
      (host) => !isAllowedHost(host, config.allowedDomains),
    );
    if (blocked.length === 0) return null;

    return { reason: 'Link não permitido neste servidor.', detail: blocked.join(', ') };
  },
};
