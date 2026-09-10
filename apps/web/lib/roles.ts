import 'server-only';

import { RoleMoveInputSchema, RoleWriteInputSchema } from '@goodbot/shared';
import { revalidatePath } from 'next/cache';

import { failure } from './action-error';
import { withAudit } from './audit';
import { requireGuildAccess } from './auth/require';
import { internalApi } from './internal-api';
import { toFieldErrors, type ActionResult } from './module-config';

import type { GuildRoleSummary } from '@goodbot/shared';

const PATH = (guildId: string) => `/g/${guildId}/cargos`;

/** Cargos da guild, do mais alto para o mais baixo (a ordem do Discord). */
export async function loadRoles(
  guildId: string,
): Promise<{ roles: GuildRoleSummary[]; error: string | null }> {
  try {
    return { roles: await internalApi().roles(guildId), error: null };
  } catch (error) {
    return { roles: [], error: failure(error).message ?? 'O bot não respondeu.' };
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

function roleId(formData: FormData): string | null {
  const value = formData.get('roleId');
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Cria ou edita um cargo (PRD §6.3). O painel só monta o payload: quem checa
 * hierarquia e chama o Discord é o bot, com o `actorId` da sessão.
 */
export async function saveRole(guildId: string, formData: FormData): Promise<ActionResult> {
  const session = await requireGuildAccess(guildId, 'admin');

  const raw = parseBody(formData.get('role'));
  const parsed = RoleWriteInputSchema.safeParse(
    typeof raw === 'object' && raw !== null ? { ...raw, actorId: session.user.id } : raw,
  );
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Confira os campos marcados.',
      fieldErrors: toFieldErrors(parsed.error),
    };
  }

  const id = roleId(formData);
  let saved: GuildRoleSummary;
  try {
    saved = id
      ? await internalApi().updateRole(guildId, id, parsed.data)
      : await internalApi().createRole(guildId, parsed.data);
  } catch (error) {
    return failure(error, 'O bot não respondeu; o cargo não foi salvo.');
  }

  await withAudit(
    { id: session.user.id, tag: session.user.name, guildId: session.guildId },
    id ? 'role.update' : 'role.create',
    { type: 'role', id: saved.id },
    null,
    parsed.data,
  );
  revalidatePath(PATH(guildId));
  return { ok: true, message: id ? 'Cargo atualizado.' : 'Cargo criado.' };
}

export async function removeRole(guildId: string, formData: FormData): Promise<ActionResult> {
  const session = await requireGuildAccess(guildId, 'admin');

  const id = roleId(formData);
  if (!id) return { ok: false, message: 'Cargo inválido.' };

  try {
    await internalApi().deleteRole(guildId, id, { actorId: session.user.id });
  } catch (error) {
    return failure(error, 'O bot não respondeu; o cargo continua lá.');
  }

  await withAudit(
    { id: session.user.id, tag: session.user.name, guildId: session.guildId },
    'role.delete',
    {
      type: 'role',
      id,
    },
  );
  revalidatePath(PATH(guildId));
  return { ok: true };
}

/** `▲`/`▼` da tabela: uma casa por clique. */
export async function moveRole(guildId: string, formData: FormData): Promise<ActionResult> {
  const session = await requireGuildAccess(guildId, 'admin');

  const id = roleId(formData);
  if (!id) return { ok: false, message: 'Cargo inválido.' };

  const parsed = RoleMoveInputSchema.safeParse({
    actorId: session.user.id,
    direction: formData.get('direction'),
  });
  if (!parsed.success) return { ok: false, message: 'Direção inválida.' };

  try {
    await internalApi().moveRole(guildId, id, parsed.data);
  } catch (error) {
    return failure(error, 'O bot não respondeu; a ordem não mudou.');
  }

  await withAudit(
    { id: session.user.id, tag: session.user.name, guildId: session.guildId },
    'role.move',
    { type: 'role', id },
    null,
    { direction: parsed.data.direction },
  );
  revalidatePath(PATH(guildId));
  return { ok: true };
}
