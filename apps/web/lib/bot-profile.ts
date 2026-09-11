import 'server-only';

import { BotProfileInputSchema } from '@goodbot/shared';
import { revalidatePath } from 'next/cache';

import { failure } from './action-error';
import { withAudit } from './audit';
import { requireGuildAccess } from './auth/require';
import { internalApi } from './internal-api';
import { toFieldErrors, type ActionResult } from './module-config';

import type { BotProfile } from '@goodbot/shared';

const PROFILE_PATH = (guildId: string) => `/g/${guildId}/perfil-do-bot`;

/**
 * Como o bot aparece **neste** servidor (PRD §6.6). Nada vem do banco: quem
 * guarda apelido, avatar e capa por servidor é o Discord, e o bot lê do membro
 * dele mesmo. Bot fora do ar devolve o motivo em vez de lançar, como as outras
 * telas que dependem da API.
 */
export async function loadBotProfile(
  guildId: string,
): Promise<{ profile: BotProfile | null; error: string | null }> {
  try {
    return { profile: await internalApi().botProfile(guildId), error: null };
  } catch (error) {
    return { profile: null, error: failure(error).message ?? 'O bot não respondeu.' };
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
 * Salva apelido, avatar e capa do bot neste servidor. O `before` vem do bot
 * antes da escrita pelo mesmo motivo do `saveGuildProfile`: trocar a cara do
 * bot sem deixar a anterior na auditoria seria poder demais para o painel
 * (§6.5).
 */
export async function saveBotProfile(guildId: string, formData: FormData): Promise<ActionResult> {
  const session = await requireGuildAccess(guildId, 'admin');

  const raw = parseBody(formData.get('profile'));
  const parsed = BotProfileInputSchema.safeParse(
    typeof raw === 'object' && raw !== null ? { ...raw, actorId: session.user.id } : raw,
  );
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Confira os campos marcados.',
      fieldErrors: toFieldErrors(parsed.error),
    };
  }

  let before: BotProfile | null = null;
  let after: BotProfile;
  try {
    before = await internalApi().botProfile(guildId);
    after = await internalApi().updateBotProfile(guildId, parsed.data);
  } catch (error) {
    return failure(error, 'O bot não respondeu; o perfil não mudou.');
  }

  await withAudit(
    { id: session.user.id, tag: session.user.name, guildId: session.guildId },
    'bot.profile.update',
    { type: 'bot', id: after.id },
    before && auditable(before),
    auditable(after),
  );
  revalidatePath(PROFILE_PATH(guildId));
  return { ok: true, message: 'Perfil do bot atualizado.' };
}

/**
 * O recorte que vai para o diff da auditoria: URL do CDN, nunca a data URL —
 * uma linha de auditoria de 8 MB em `jsonb` seria um jeito caro de guardar uma
 * foto.
 */
function auditable(profile: BotProfile) {
  return {
    nick: profile.nick,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl,
    bannerUrl: profile.bannerUrl,
  };
}
