import 'server-only';

import {
  countPanels,
  createPanel,
  deletePanel,
  getPanel,
  listPanelItems,
  listPanels,
  replacePanelItems,
  updatePanel,
} from '@goodbot/db';
import { ReactionRolePanelInputSchema, type ReactionRolePanelInput } from '@goodbot/shared';
import { revalidatePath } from 'next/cache';

import { withAudit } from './audit';
import { defaultGuildId, requireGuildAccess } from './auth/require';
import { db } from './db';
import { internalApi } from './internal-api';
import { loadModuleConfig, toFieldErrors, type ActionResult } from './module-config';

const PATH = (guildId: string) => `/g/${guildId}/config/reaction-roles`;

export type PanelRow = ReactionRolePanelInput & {
  id: string;
  /** `null` = rascunho, ainda não publicado. */
  messageId: string | null;
};

/** Os painéis da guild com os cargos já carregados, prontos para o editor. */
export async function loadPanels(guildId: string): Promise<PanelRow[]> {
  const panels = await listPanels(db(), guildId);
  return Promise.all(
    panels.map(async (panel) => ({
      id: panel.id,
      channelId: panel.channelId,
      messageId: panel.messageId,
      mode: panel.mode,
      style: panel.style,
      content: panel.content,
      items: (await listPanelItems(db(), panel.id)).map((item) => ({
        roleId: item.roleId,
        emoji: item.emoji,
        label: item.label,
        description: item.description,
      })),
    })),
  );
}

function parseBody(raw: FormDataEntryValue | null): unknown {
  if (typeof raw !== 'string') return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function panelId(formData: FormData): string | null {
  const value = formData.get('panelId');
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Cria ou edita um painel. Salvar **não** republica: quem já tem a mensagem no
 * ar decide quando atualizar, no botão `ATUALIZAR`.
 */
export async function savePanel(formData: FormData): Promise<ActionResult> {
  const guildId = await defaultGuildId();
  const session = await requireGuildAccess(guildId, 'admin');

  const parsed = ReactionRolePanelInputSchema.safeParse(parseBody(formData.get('panel')));
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Confira os campos marcados.',
      fieldErrors: toFieldErrors(parsed.error),
    };
  }
  const input = parsed.data;
  const id = panelId(formData);

  const before = id ? await getPanel(db(), guildId, id) : null;
  if (id && !before) return { ok: false, message: 'Esse painel não existe mais.' };

  if (!id) {
    const { maxPanels } = (await loadModuleConfig(guildId, 'reaction_roles')).config;
    if ((await countPanels(db(), guildId)) >= maxPanels) {
      return { ok: false, message: `Limite de ${maxPanels} painéis atingido.` };
    }
  }

  const panel = id
    ? await updatePanel(db(), guildId, id, {
        channelId: input.channelId,
        mode: input.mode,
        style: input.style,
        content: input.content,
      })
    : await createPanel(db(), {
        guildId,
        channelId: input.channelId,
        mode: input.mode,
        style: input.style,
        content: input.content,
      });
  if (!panel) return { ok: false, message: 'Esse painel não existe mais.' };

  await replacePanelItems(db(), panel.id, input.items);

  await withAudit(
    { id: session.user.id, tag: session.user.name, guildId: session.guildId },
    id ? 'reaction_roles.panel.update' : 'reaction_roles.panel.create',
    { type: 'reaction_role_panel', id: panel.id },
    before,
    input,
  );
  revalidatePath(PATH(guildId));
  return { ok: true };
}

/** `PUBLICAR` / `ATUALIZAR`: o bot é quem monta e envia a mensagem. */
export async function publishPanel(formData: FormData): Promise<ActionResult> {
  const guildId = await defaultGuildId();
  const session = await requireGuildAccess(guildId, 'admin');

  const id = panelId(formData);
  if (!id) return { ok: false, message: 'Painel inválido.' };

  try {
    await internalApi().publishReactionRolePanel(guildId, id);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'O bot não respondeu.' };
  }

  await withAudit(
    { id: session.user.id, tag: session.user.name, guildId: session.guildId },
    'reaction_roles.panel.publish',
    {
      type: 'reaction_role_panel',
      id,
    },
  );
  revalidatePath(PATH(guildId));
  return { ok: true, message: 'Painel publicado.' };
}

/**
 * `REMOVER`: apaga a mensagem publicada e a linha. A mensagem sai primeiro —
 * apagar a linha antes deixaria um painel órfão no canal, que ninguém mais
 * conseguiria alcançar pelo dashboard.
 */
export async function removePanel(formData: FormData): Promise<ActionResult> {
  const guildId = await defaultGuildId();
  const session = await requireGuildAccess(guildId, 'admin');

  const id = panelId(formData);
  if (!id) return { ok: false, message: 'Painel inválido.' };

  const before = await getPanel(db(), guildId, id);
  if (!before) return { ok: false, message: 'Esse painel não existe mais.' };

  let warning: string | undefined;
  if (before.messageId) {
    try {
      await internalApi().unpublishReactionRolePanel(guildId, id);
    } catch {
      warning = 'Painel removido, mas a mensagem no Discord pode ter ficado. Apague-a à mão.';
    }
  }

  if (!(await deletePanel(db(), guildId, id))) {
    return { ok: false, message: 'Esse painel não existe mais.' };
  }

  await withAudit(
    { id: session.user.id, tag: session.user.name, guildId: session.guildId },
    'reaction_roles.panel.delete',
    { type: 'reaction_role_panel', id },
    before,
    null,
  );
  revalidatePath(PATH(guildId));
  return warning ? { ok: true, message: warning } : { ok: true };
}
