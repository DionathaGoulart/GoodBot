import 'server-only';

import {
  ChannelCreateInputSchema,
  ChannelOverridesInputSchema,
  ChannelUpdateInputSchema,
  MANAGED_CHANNEL_TYPES,
  SlowmodeInputSchema,
} from '@cobot/shared';
import { revalidatePath } from 'next/cache';

import { failure } from './action-error';
import { withAudit } from './audit';
import { defaultGuildId, requireGuildAccess } from './auth/require';
import { internalApi } from './internal-api';
import { toFieldErrors, type ActionResult } from './module-config';

import type { GuildChannelDetail, GuildChannelSummary } from '@cobot/shared';

const PATH = (guildId: string) => `/g/${guildId}/canais`;

/** Uma categoria com os canais dela; `id: null` é o grupo "sem categoria". */
export interface ChannelBranch {
  id: string | null;
  name: string;
  position: number;
  children: GuildChannelSummary[];
}

/**
 * A árvore da tela de canais (§6.3). Só agrupa — a ordenação é a do Discord,
 * porque o painel não reordena canais (sem drag na v1).
 */
export function toChannelTree(channels: GuildChannelSummary[]): ChannelBranch[] {
  const categories = channels
    .filter((channel) => channel.type === MANAGED_CHANNEL_TYPES.category)
    .sort((a, b) => a.position - b.position);

  const branches: ChannelBranch[] = categories.map((category) => ({
    id: category.id,
    name: category.name,
    position: category.position,
    children: [],
  }));
  const loose: ChannelBranch = { id: null, name: 'SEM CATEGORIA', position: -1, children: [] };
  const byId = new Map(branches.map((branch) => [branch.id, branch]));

  for (const channel of channels) {
    if (channel.type === MANAGED_CHANNEL_TYPES.category) continue;
    const branch = (channel.parentId && byId.get(channel.parentId)) || loose;
    branch.children.push(channel);
  }
  for (const branch of [loose, ...branches]) {
    branch.children.sort((a, b) => a.position - b.position);
  }

  return loose.children.length > 0 ? [loose, ...branches] : branches;
}

export async function loadChannels(
  guildId: string,
): Promise<{ tree: ChannelBranch[]; error: string | null }> {
  try {
    return { tree: toChannelTree(await internalApi().channels(guildId)), error: null };
  } catch (error) {
    return { tree: [], error: failure(error).message ?? 'O bot não respondeu.' };
  }
}

/**
 * O detalhe de um canal (tópico, NSFW, modo lento, overrides). Carregado sob
 * demanda: puxar isso de todo canal na abertura da página seria uma chamada por
 * canal para uma informação que só o formulário aberto usa.
 */
export async function loadChannelDetail(
  channelId: string,
): Promise<{ ok: true; detail: GuildChannelDetail } | { ok: false; message: string }> {
  const guildId = defaultGuildId();
  await requireGuildAccess(guildId, 'admin');

  try {
    return { ok: true, detail: await internalApi().channel(guildId, channelId) };
  } catch (error) {
    return { ok: false, message: failure(error).message ?? 'O bot não respondeu.' };
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

function channelId(formData: FormData): string | null {
  const value = formData.get('channelId');
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Cria (sem `channelId`) ou edita (com) um canal ou categoria. */
export async function saveChannel(formData: FormData): Promise<ActionResult> {
  const guildId = defaultGuildId();
  const session = await requireGuildAccess(guildId, 'admin');

  const id = channelId(formData);
  const raw = parseBody(formData.get('channel'));
  const withActor =
    typeof raw === 'object' && raw !== null ? { ...raw, actorId: session.user.id } : raw;

  // Criar e editar têm schemas diferentes (o tipo do canal não muda depois),
  // então cada ramo valida com o seu e a chamada sai já tipada.
  const parsed = id
    ? ChannelUpdateInputSchema.safeParse(withActor)
    : ChannelCreateInputSchema.safeParse(withActor);
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Confira os campos marcados.',
      fieldErrors: toFieldErrors(parsed.error),
    };
  }

  try {
    await (id
      ? internalApi().updateChannel(guildId, id, ChannelUpdateInputSchema.parse(withActor))
      : internalApi().createChannel(guildId, ChannelCreateInputSchema.parse(withActor)));
  } catch (error) {
    return failure(error, 'O bot não respondeu; o canal não foi salvo.');
  }

  await withAudit(
    { id: session.user.id, tag: session.user.name },
    id ? 'channel.update' : 'channel.create',
    { type: 'channel', id: id ?? undefined },
    null,
    parsed.data,
  );
  revalidatePath(PATH(guildId));
  return { ok: true, message: id ? 'Canal atualizado.' : 'Canal criado.' };
}

export async function removeChannel(formData: FormData): Promise<ActionResult> {
  const guildId = defaultGuildId();
  const session = await requireGuildAccess(guildId, 'admin');

  const id = channelId(formData);
  if (!id) return { ok: false, message: 'Canal inválido.' };

  try {
    await internalApi().deleteChannel(guildId, id, { actorId: session.user.id });
  } catch (error) {
    return failure(error, 'O bot não respondeu; o canal continua lá.');
  }

  await withAudit({ id: session.user.id, tag: session.user.name }, 'channel.delete', {
    type: 'channel',
    id,
  });
  revalidatePath(PATH(guildId));
  return { ok: true };
}

export async function setSlowmode(formData: FormData): Promise<ActionResult> {
  const guildId = defaultGuildId();
  const session = await requireGuildAccess(guildId, 'admin');

  const id = channelId(formData);
  if (!id) return { ok: false, message: 'Canal inválido.' };

  const parsed = SlowmodeInputSchema.safeParse({
    actorId: session.user.id,
    seconds: Number(formData.get('seconds')),
  });
  if (!parsed.success) return { ok: false, message: 'Modo lento inválido (0 a 6 horas).' };

  try {
    await internalApi().setSlowmode(guildId, id, parsed.data);
  } catch (error) {
    return failure(error, 'O bot não respondeu; o modo lento não mudou.');
  }

  await withAudit(
    { id: session.user.id, tag: session.user.name },
    'channel.slowmode',
    { type: 'channel', id },
    null,
    { seconds: parsed.data.seconds },
  );
  revalidatePath(PATH(guildId));
  return { ok: true, message: `Modo lento em ${parsed.data.seconds}s.` };
}

/**
 * `TRANCAR`/`DESTRANCAR`: mexe só no `SendMessages` do `@everyone`, do mesmo
 * jeito que o `/lock` dentro do Discord — então um desfaz o outro.
 */
export async function toggleChannelLock(formData: FormData): Promise<ActionResult> {
  const guildId = defaultGuildId();
  const session = await requireGuildAccess(guildId, 'admin');

  const id = channelId(formData);
  if (!id) return { ok: false, message: 'Canal inválido.' };
  const lock = formData.get('lock') === 'true';

  try {
    const api = internalApi();
    await (lock
      ? api.lockChannel(guildId, id, { actorId: session.user.id })
      : api.unlockChannel(guildId, id, { actorId: session.user.id }));
  } catch (error) {
    return failure(error, 'O bot não respondeu; o canal não mudou.');
  }

  await withAudit({ id: session.user.id, tag: session.user.name }, lock ? 'channel.lock' : 'channel.unlock', {
    type: 'channel',
    id,
  });
  revalidatePath(PATH(guildId));
  return { ok: true, message: lock ? 'Canal trancado.' : 'Canal destrancado.' };
}

export async function setChannelOverrides(formData: FormData): Promise<ActionResult> {
  const guildId = defaultGuildId();
  const session = await requireGuildAccess(guildId, 'admin');

  const id = channelId(formData);
  if (!id) return { ok: false, message: 'Canal inválido.' };

  const raw = parseBody(formData.get('overrides'));
  const parsed = ChannelOverridesInputSchema.safeParse({
    actorId: session.user.id,
    overrides: raw,
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Confira as permissões marcadas.',
      fieldErrors: toFieldErrors(parsed.error),
    };
  }

  let before;
  try {
    before = await internalApi().channel(guildId, id);
    await internalApi().setChannelOverrides(guildId, id, parsed.data);
  } catch (error) {
    return failure(error, 'O bot não respondeu; as permissões não mudaram.');
  }

  await withAudit(
    { id: session.user.id, tag: session.user.name },
    'channel.overrides',
    { type: 'channel', id },
    before?.overrides ?? null,
    parsed.data.overrides,
  );
  revalidatePath(PATH(guildId));
  return { ok: true, message: 'Permissões do canal atualizadas.' };
}
