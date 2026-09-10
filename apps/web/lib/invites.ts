import 'server-only';

import { ActorInputSchema, CreateInviteInputSchema } from '@goodbot/shared';
import { revalidatePath } from 'next/cache';

import { failure } from './action-error';
import { withAudit } from './audit';
import { defaultGuildId, requireGuildAccess } from './auth/require';
import { internalApi } from './internal-api';
import { toFieldErrors, type ActionResult } from './module-config';

import type { GuildInviteList } from '@goodbot/shared';

const PATH = (guildId: string) => `/g/${guildId}/convites`;

/**
 * Convites do servidor (§6.3). Lidos ao vivo pelo bot — o Discord é a única
 * fonte da contagem de usos, e ela muda sem avisar ninguém.
 */
export async function loadInvites(
  guildId: string,
): Promise<{ list: GuildInviteList | null; error: string | null }> {
  try {
    return { list: await internalApi().invites(guildId), error: null };
  } catch (error) {
    return { list: null, error: failure(error).message ?? 'O bot não respondeu.' };
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

export async function createInvite(formData: FormData): Promise<ActionResult> {
  const guildId = defaultGuildId();
  const session = await requireGuildAccess(guildId, 'admin');

  const raw = parseBody(formData.get('invite'));
  const parsed = CreateInviteInputSchema.safeParse(
    typeof raw === 'object' && raw !== null ? { ...raw, actorId: session.user.id } : raw,
  );
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Confira os campos marcados.',
      fieldErrors: toFieldErrors(parsed.error),
    };
  }

  let invite;
  try {
    invite = await internalApi().createInvite(guildId, parsed.data);
  } catch (error) {
    return failure(error, 'O bot não respondeu; o convite não foi criado.');
  }

  await withAudit(
    { id: session.user.id, tag: session.user.name },
    'invite.create',
    { type: 'invite', id: invite.code },
    null,
    {
      code: invite.code,
      url: invite.url,
      channelId: invite.channel?.id ?? null,
      maxAge: invite.maxAge,
      maxUses: invite.maxUses,
      temporary: invite.temporary,
    },
  );

  revalidatePath(PATH(guildId));
  return { ok: true, message: `Convite ${invite.url} criado.` };
}

/** Revogar um convite. O `before` é o que a auditoria guarda: depois some. */
export async function deleteInvite(formData: FormData): Promise<ActionResult> {
  const guildId = defaultGuildId();
  const session = await requireGuildAccess(guildId, 'admin');

  const code = formData.get('code');
  if (typeof code !== 'string' || code === '') return { ok: false, message: 'Convite inválido.' };

  const parsed = ActorInputSchema.safeParse({ actorId: session.user.id });
  if (!parsed.success) return { ok: false, message: 'Sessão inválida.' };

  const { list } = await loadInvites(guildId);
  const before = list?.invites.find((invite) => invite.code === code) ?? null;

  try {
    await internalApi().deleteInvite(guildId, code, parsed.data);
  } catch (error) {
    return failure(error, 'O bot não respondeu; o convite continua valendo.');
  }

  await withAudit(
    { id: session.user.id, tag: session.user.name },
    'invite.delete',
    { type: 'invite', id: code },
    before,
    null,
  );

  revalidatePath(PATH(guildId));
  return { ok: true, message: 'Convite revogado.' };
}
