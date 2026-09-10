import 'server-only';

import { countTags, createTag, deleteTag, getTag, listTags, updateTag } from '@goodbot/db';
import { TagInputSchema } from '@goodbot/shared';
import { revalidatePath } from 'next/cache';

import { withAudit } from './audit';
import { defaultGuildId, requireGuildAccess } from './auth/require';
import { db } from './db';
import { loadModuleConfig, toFieldErrors, type ActionResult } from './module-config';

import type { Tag } from '@goodbot/db';

export interface TagRow {
  name: string;
  content: Tag['content'];
  uses: number;
  createdBy: string;
  updatedAt: string;
}

/** As tags da guild, já serializadas para atravessar até o client component. */
export async function loadTags(guildId: string): Promise<TagRow[]> {
  const rows = await listTags(db(), guildId);
  return rows.map((row) => ({
    name: row.name,
    content: row.content,
    uses: row.uses,
    createdBy: row.createdBy,
    updatedAt: row.updatedAt.toISOString(),
  }));
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
 * Cria ou edita uma tag (PRD §6.2). Diferente das outras telas, tags não moram
 * em `module_configs` — cada uma é uma linha em `tags`, com contador de uso
 * próprio. Por isso o nome é imutável na edição: renomear jogaria fora o
 * histórico de `uses` da linha.
 */
export async function saveTag(formData: FormData): Promise<ActionResult> {
  const guildId = defaultGuildId();
  const session = await requireGuildAccess(guildId, 'admin');

  const parsed = TagInputSchema.safeParse(parseBody(formData.get('tag')));
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Confira os campos marcados.',
      fieldErrors: toFieldErrors(parsed.error),
    };
  }
  const { name, content } = parsed.data;
  const isEdit = formData.get('mode') === 'edit';

  const before = await getTag(db(), guildId, name);
  if (isEdit && !before) return { ok: false, message: 'Essa tag não existe mais.' };
  if (!isEdit && before) {
    return {
      ok: false,
      message: 'Já existe uma tag com esse nome.',
      fieldErrors: { name: 'Nome em uso' },
    };
  }

  if (!isEdit) {
    const { maxTags } = (await loadModuleConfig(guildId, 'tags')).config;
    if ((await countTags(db(), guildId)) >= maxTags) {
      return { ok: false, message: `Limite de ${maxTags} tags atingido.` };
    }
    const created = await createTag(db(), { guildId, name, content, createdBy: session.user.id });
    if (!created) return { ok: false, message: 'Já existe uma tag com esse nome.' };
  } else if (!(await updateTag(db(), guildId, name, content))) {
    return { ok: false, message: 'Essa tag não existe mais.' };
  }

  await withAudit(
    { id: session.user.id, tag: session.user.name, guildId: session.guildId },
    isEdit ? 'tag.update' : 'tag.create',
    { type: 'tag', id: name },
    before?.content ?? null,
    content,
  );
  revalidatePath(`/g/${guildId}/config/tags`);
  return { ok: true };
}

export async function removeTag(formData: FormData): Promise<ActionResult> {
  const guildId = defaultGuildId();
  const session = await requireGuildAccess(guildId, 'admin');

  const name = formData.get('name');
  if (typeof name !== 'string' || name.length === 0) {
    return { ok: false, message: 'Tag inválida.' };
  }

  const removed = await deleteTag(db(), guildId, name);
  if (!removed) return { ok: false, message: 'Essa tag não existe mais.' };

  await withAudit(
    { id: session.user.id, tag: session.user.name, guildId: session.guildId },
    'tag.delete',
    { type: 'tag', id: removed.name },
    removed.content,
    null,
  );
  revalidatePath(`/g/${guildId}/config/tags`);
  return { ok: true };
}
