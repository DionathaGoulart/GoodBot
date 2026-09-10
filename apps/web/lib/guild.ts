import 'server-only';

import { ActorInputSchema, BanListQuerySchema, GuildSettingsInputSchema } from '@goodbot/shared';
import { revalidatePath } from 'next/cache';

import { failure } from './action-error';
import { withAudit } from './audit';
import { defaultGuildId, requireGuildAccess } from './auth/require';
import { internalApi } from './internal-api';
import { toFieldErrors, type ActionResult } from './module-config';

import type { BanListQuery, GuildBanPage, GuildProfile } from '@goodbot/shared';

const SETTINGS_PATH = (guildId: string) => `/g/${guildId}/servidor`;
const BANS_PATH = (guildId: string) => `/g/${guildId}/banidos`;

/**
 * O servidor como o Discord o guarda (§6.3). Bot fora do ar devolve o motivo
 * em vez de lançar: a tela mostra o banner de erro no lugar do formulário.
 */
export async function loadGuildProfile(
  guildId: string,
): Promise<{ profile: GuildProfile | null; error: string | null }> {
  try {
    return { profile: await internalApi().guildProfile(guildId), error: null };
  } catch (error) {
    return { profile: null, error: failure(error).message ?? 'O bot não respondeu.' };
  }
}

export async function loadBans(
  guildId: string,
  query: Partial<BanListQuery> = {},
): Promise<{ page: GuildBanPage | null; error: string | null }> {
  try {
    return { page: await internalApi().bans(guildId, query), error: null };
  } catch (error) {
    return { page: null, error: failure(error).message ?? 'O bot não respondeu.' };
  }
}

function parseBody(raw: FormDataEntryValue | null): unknown {
  if (typeof raw !== 'string') return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * Salva nome, imagens e ajustes do servidor. O `before` vem do próprio bot
 * antes da escrita: trocar o ícone do servidor sem deixar o valor antigo na
 * auditoria seria o pior tipo de poder que o painel pode ter (§6.5).
 */
export async function saveGuildProfile(formData: FormData): Promise<ActionResult> {
  const guildId = defaultGuildId();
  const session = await requireGuildAccess(guildId, 'admin');

  const raw = parseBody(formData.get('settings'));
  const parsed = GuildSettingsInputSchema.safeParse(
    typeof raw === 'object' && raw !== null ? { ...raw, actorId: session.user.id } : raw,
  );
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Confira os campos marcados.',
      fieldErrors: toFieldErrors(parsed.error),
    };
  }

  let before: GuildProfile | null = null;
  let after: GuildProfile;
  try {
    before = await internalApi().guildProfile(guildId);
    after = await internalApi().updateGuildProfile(guildId, parsed.data);
  } catch (error) {
    return failure(error, 'O bot não respondeu; o servidor não mudou.');
  }

  await withAudit(
    { id: session.user.id, tag: session.user.name, guildId: session.guildId },
    'guild.update',
    { type: 'guild', id: guildId },
    before && auditable(before),
    auditable(after),
  );
  revalidatePath(SETTINGS_PATH(guildId));
  return { ok: true, message: 'Servidor atualizado.' };
}

/**
 * O recorte que vai para o diff da auditoria. As imagens entram como URL do
 * CDN (que muda a cada troca), nunca como a data URL — uma linha de auditoria
 * de 8 MB em `jsonb` seria um jeito caro de guardar uma foto.
 */
function auditable(profile: GuildProfile) {
  return {
    name: profile.name,
    description: profile.description,
    iconUrl: profile.iconUrl,
    bannerUrl: profile.bannerUrl,
    verificationLevel: profile.verificationLevel,
    systemChannelId: profile.systemChannelId,
    afkChannelId: profile.afkChannelId,
    afkTimeout: profile.afkTimeout,
  };
}

/**
 * Desbanir pelo painel (§6.3). Quem executa é o bot, pelo mesmo serviço do
 * `/unban`, então caso, mod-log e agendamento cancelado saem idênticos — só o
 * `source` muda para `dashboard`.
 */
export async function unbanUser(formData: FormData): Promise<ActionResult> {
  const guildId = defaultGuildId();
  const session = await requireGuildAccess(guildId, 'mod');

  const userId = formData.get('userId');
  if (typeof userId !== 'string' || userId === '') {
    return { ok: false, message: 'Usuário inválido.' };
  }
  const reason = formData.get('reason');
  const parsed = ActorInputSchema.safeParse({
    actorId: session.user.id,
    ...(typeof reason === 'string' && reason.trim() !== '' ? { reason: reason.trim() } : {}),
  });
  if (!parsed.success) return { ok: false, message: 'Motivo longo demais.' };

  let result;
  try {
    result = await internalApi().unban(guildId, userId, parsed.data);
  } catch (error) {
    return failure(error, 'O bot não respondeu; o banimento continua.');
  }

  await withAudit(
    { id: session.user.id, tag: session.user.name, guildId: session.guildId },
    'member.unban',
    { type: 'member', id: userId },
    null,
    { ...parsed.data, caseNumber: result.caseNumber },
  );
  revalidatePath(BANS_PATH(guildId));
  return { ok: true, message: `Desbanido. Caso #${String(result.caseNumber)}.` };
}

/** Uma página a mais de banidos, para o botão "carregar mais" da tabela. */
export async function loadMoreBans(
  query: Partial<BanListQuery>,
): Promise<{ ok: true; page: GuildBanPage } | { ok: false; message: string }> {
  const guildId = defaultGuildId();
  await requireGuildAccess(guildId, 'mod');

  const parsed = BanListQuerySchema.safeParse(query);
  if (!parsed.success) return { ok: false, message: 'Busca inválida.' };

  const { page, error } = await loadBans(guildId, parsed.data);
  return page ? { ok: true, page } : { ok: false, message: error ?? 'O bot não respondeu.' };
}
