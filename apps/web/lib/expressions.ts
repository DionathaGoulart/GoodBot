import 'server-only';

import {
  ActorInputSchema,
  EmojiCreateInputSchema,
  EmojiUpdateInputSchema,
  StickerCreateInputSchema,
  StickerUpdateInputSchema,
} from '@goodbot/shared';
import { revalidatePath } from 'next/cache';

import { failure } from './action-error';
import { withAudit } from './audit';
import { defaultGuildId, requireGuildAccess } from './auth/require';
import { internalApi } from './internal-api';
import { toFieldErrors, type ActionResult } from './module-config';

import type { ExpressionOverview } from '@goodbot/shared';

const PATH = (guildId: string) => `/g/${guildId}/emojis`;

export async function loadExpressions(
  guildId: string,
): Promise<{ overview: ExpressionOverview | null; error: string | null }> {
  try {
    return { overview: await internalApi().expressions(guildId), error: null };
  } catch (error) {
    return { overview: null, error: failure(error).message ?? 'O bot não respondeu.' };
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

function invalid(error: Parameters<typeof toFieldErrors>[0]): ActionResult {
  return { ok: false, message: 'Confira os campos marcados.', fieldErrors: toFieldErrors(error) };
}

/**
 * Sobe um emoji (§6.3). A imagem em si nunca vai para a auditoria: fica o
 * nome, o id e a URL do CDN, que é o que alguém precisa para reconhecer o que
 * entrou no servidor.
 */
export async function createEmoji(formData: FormData): Promise<ActionResult> {
  const guildId = await defaultGuildId();
  const session = await requireGuildAccess(guildId, 'admin');

  const raw = parseBody(formData.get('emoji'));
  const parsed = EmojiCreateInputSchema.safeParse(
    typeof raw === 'object' && raw !== null ? { ...raw, actorId: session.user.id } : raw,
  );
  if (!parsed.success) return invalid(parsed.error);

  let emoji;
  try {
    emoji = await internalApi().createEmoji(guildId, parsed.data);
  } catch (error) {
    return failure(error, 'O bot não respondeu; o emoji não subiu.');
  }

  await withAudit(
    { id: session.user.id, tag: session.user.name, guildId: session.guildId },
    'emoji.create',
    { type: 'emoji', id: emoji.id },
    null,
    { name: emoji.name, url: emoji.url, animated: emoji.animated, roleIds: emoji.roleIds },
  );

  revalidatePath(PATH(guildId));
  return { ok: true, message: `Emoji :${emoji.name}: criado.` };
}

export async function updateEmoji(formData: FormData): Promise<ActionResult> {
  const guildId = await defaultGuildId();
  const session = await requireGuildAccess(guildId, 'admin');

  const emojiId = formData.get('emojiId');
  if (typeof emojiId !== 'string' || emojiId === '')
    return { ok: false, message: 'Emoji inválido.' };

  const raw = parseBody(formData.get('emoji'));
  const parsed = EmojiUpdateInputSchema.safeParse(
    typeof raw === 'object' && raw !== null ? { ...raw, actorId: session.user.id } : raw,
  );
  if (!parsed.success) return invalid(parsed.error);

  const { overview } = await loadExpressions(guildId);
  const before = overview?.emojis.find((emoji) => emoji.id === emojiId) ?? null;

  let emoji;
  try {
    emoji = await internalApi().updateEmoji(guildId, emojiId, parsed.data);
  } catch (error) {
    return failure(error, 'O bot não respondeu; o emoji não mudou.');
  }

  await withAudit(
    { id: session.user.id, tag: session.user.name, guildId: session.guildId },
    'emoji.update',
    { type: 'emoji', id: emojiId },
    before && { name: before.name, roleIds: before.roleIds },
    { name: emoji.name, roleIds: emoji.roleIds },
  );

  revalidatePath(PATH(guildId));
  return { ok: true, message: 'Emoji atualizado.' };
}

export async function deleteEmoji(formData: FormData): Promise<ActionResult> {
  const guildId = await defaultGuildId();
  const session = await requireGuildAccess(guildId, 'admin');

  const emojiId = formData.get('emojiId');
  if (typeof emojiId !== 'string' || emojiId === '')
    return { ok: false, message: 'Emoji inválido.' };

  const parsed = ActorInputSchema.safeParse({ actorId: session.user.id });
  if (!parsed.success) return { ok: false, message: 'Sessão inválida.' };

  const { overview } = await loadExpressions(guildId);
  const before = overview?.emojis.find((emoji) => emoji.id === emojiId) ?? null;

  try {
    await internalApi().deleteEmoji(guildId, emojiId, parsed.data);
  } catch (error) {
    return failure(error, 'O bot não respondeu; o emoji continua lá.');
  }

  await withAudit(
    { id: session.user.id, tag: session.user.name, guildId: session.guildId },
    'emoji.delete',
    { type: 'emoji', id: emojiId },
    before,
    null,
  );

  revalidatePath(PATH(guildId));
  return { ok: true, message: 'Emoji apagado.' };
}

export async function createSticker(formData: FormData): Promise<ActionResult> {
  const guildId = await defaultGuildId();
  const session = await requireGuildAccess(guildId, 'admin');

  const raw = parseBody(formData.get('sticker'));
  const parsed = StickerCreateInputSchema.safeParse(
    typeof raw === 'object' && raw !== null ? { ...raw, actorId: session.user.id } : raw,
  );
  if (!parsed.success) return invalid(parsed.error);

  let sticker;
  try {
    sticker = await internalApi().createSticker(guildId, parsed.data);
  } catch (error) {
    return failure(error, 'O bot não respondeu; o sticker não subiu.');
  }

  await withAudit(
    { id: session.user.id, tag: session.user.name, guildId: session.guildId },
    'sticker.create',
    { type: 'sticker', id: sticker.id },
    null,
    { name: sticker.name, url: sticker.url, tags: sticker.tags },
  );

  revalidatePath(PATH(guildId));
  return { ok: true, message: `Sticker ${sticker.name} criado.` };
}

export async function updateSticker(formData: FormData): Promise<ActionResult> {
  const guildId = await defaultGuildId();
  const session = await requireGuildAccess(guildId, 'admin');

  const stickerId = formData.get('stickerId');
  if (typeof stickerId !== 'string' || stickerId === '') {
    return { ok: false, message: 'Sticker inválido.' };
  }

  const raw = parseBody(formData.get('sticker'));
  const parsed = StickerUpdateInputSchema.safeParse(
    typeof raw === 'object' && raw !== null ? { ...raw, actorId: session.user.id } : raw,
  );
  if (!parsed.success) return invalid(parsed.error);

  const { overview } = await loadExpressions(guildId);
  const before = overview?.stickers.find((sticker) => sticker.id === stickerId) ?? null;

  let sticker;
  try {
    sticker = await internalApi().updateSticker(guildId, stickerId, parsed.data);
  } catch (error) {
    return failure(error, 'O bot não respondeu; o sticker não mudou.');
  }

  await withAudit(
    { id: session.user.id, tag: session.user.name, guildId: session.guildId },
    'sticker.update',
    { type: 'sticker', id: stickerId },
    before && { name: before.name, description: before.description, tags: before.tags },
    { name: sticker.name, description: sticker.description, tags: sticker.tags },
  );

  revalidatePath(PATH(guildId));
  return { ok: true, message: 'Sticker atualizado.' };
}

export async function deleteSticker(formData: FormData): Promise<ActionResult> {
  const guildId = await defaultGuildId();
  const session = await requireGuildAccess(guildId, 'admin');

  const stickerId = formData.get('stickerId');
  if (typeof stickerId !== 'string' || stickerId === '') {
    return { ok: false, message: 'Sticker inválido.' };
  }

  const parsed = ActorInputSchema.safeParse({ actorId: session.user.id });
  if (!parsed.success) return { ok: false, message: 'Sessão inválida.' };

  const { overview } = await loadExpressions(guildId);
  const before = overview?.stickers.find((sticker) => sticker.id === stickerId) ?? null;

  try {
    await internalApi().deleteSticker(guildId, stickerId, parsed.data);
  } catch (error) {
    return failure(error, 'O bot não respondeu; o sticker continua lá.');
  }

  await withAudit(
    { id: session.user.id, tag: session.user.name, guildId: session.guildId },
    'sticker.delete',
    { type: 'sticker', id: stickerId },
    before,
    null,
  );

  revalidatePath(PATH(guildId));
  return { ok: true, message: 'Sticker apagado.' };
}
