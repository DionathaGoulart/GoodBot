'use server';

import {
  loadChannelDetail,
  removeChannel,
  saveChannel,
  setChannelOverrides,
  setSlowmode,
  toggleChannelLock,
} from '@/lib/channels';
import { deleteScheduledEvent, saveScheduledEvent } from '@/lib/events';
import {
  createEmoji,
  createSticker,
  deleteEmoji,
  deleteSticker,
  updateEmoji,
  updateSticker,
} from '@/lib/expressions';
import { loadMoreBans, saveGuildProfile, unbanUser } from '@/lib/guild';
import { createInvite, deleteInvite } from '@/lib/invites';
import { punishMember, setMemberRoles } from '@/lib/members';
import { moveRole, removeRole, saveRole } from '@/lib/roles';

import type { ActionResult } from '@/lib/module-config';
import type { BanListQuery, GuildBanPage, GuildChannelDetail } from '@cobot/shared';

/**
 * As ações da gestão de servidor (Etapa 16). Cascas finas sobre o `lib/`
 * correspondente: a checagem de permissão e a auditoria moram lá, junto da
 * escrita, para nenhum caminho novo escapar delas.
 */

// ── membros ─────────────────────────────────────────────────────────────────

export async function punishMemberAction(formData: FormData): Promise<ActionResult> {
  return punishMember(formData);
}

export async function setMemberRolesAction(formData: FormData): Promise<ActionResult> {
  return setMemberRoles(formData);
}

// ── cargos ──────────────────────────────────────────────────────────────────

export async function saveRoleAction(formData: FormData): Promise<ActionResult> {
  return saveRole(formData);
}

export async function deleteRoleAction(formData: FormData): Promise<ActionResult> {
  return removeRole(formData);
}

export async function moveRoleAction(formData: FormData): Promise<ActionResult> {
  return moveRole(formData);
}

// ── canais ──────────────────────────────────────────────────────────────────

export async function loadChannelDetailAction(
  channelId: string,
): Promise<{ ok: true; detail: GuildChannelDetail } | { ok: false; message: string }> {
  return loadChannelDetail(channelId);
}

export async function saveChannelAction(formData: FormData): Promise<ActionResult> {
  return saveChannel(formData);
}

export async function deleteChannelAction(formData: FormData): Promise<ActionResult> {
  return removeChannel(formData);
}

export async function setSlowmodeAction(formData: FormData): Promise<ActionResult> {
  return setSlowmode(formData);
}

export async function toggleChannelLockAction(formData: FormData): Promise<ActionResult> {
  return toggleChannelLock(formData);
}

export async function setChannelOverridesAction(formData: FormData): Promise<ActionResult> {
  return setChannelOverrides(formData);
}

// ── servidor e banidos ──────────────────────────────────────────────────────

export async function saveGuildProfileAction(formData: FormData): Promise<ActionResult> {
  return saveGuildProfile(formData);
}

export async function unbanUserAction(formData: FormData): Promise<ActionResult> {
  return unbanUser(formData);
}

export async function loadMoreBansAction(
  query: Partial<BanListQuery>,
): Promise<{ ok: true; page: GuildBanPage } | { ok: false; message: string }> {
  return loadMoreBans(query);
}

// ── convites, eventos e emojis (Etapa 25) ───────────────────────────────────

export async function createInviteAction(formData: FormData): Promise<ActionResult> {
  return createInvite(formData);
}

export async function deleteInviteAction(formData: FormData): Promise<ActionResult> {
  return deleteInvite(formData);
}

export async function saveScheduledEventAction(formData: FormData): Promise<ActionResult> {
  return saveScheduledEvent(formData);
}

export async function deleteScheduledEventAction(formData: FormData): Promise<ActionResult> {
  return deleteScheduledEvent(formData);
}

export async function createEmojiAction(formData: FormData): Promise<ActionResult> {
  return createEmoji(formData);
}

export async function updateEmojiAction(formData: FormData): Promise<ActionResult> {
  return updateEmoji(formData);
}

export async function deleteEmojiAction(formData: FormData): Promise<ActionResult> {
  return deleteEmoji(formData);
}

export async function createStickerAction(formData: FormData): Promise<ActionResult> {
  return createSticker(formData);
}

export async function updateStickerAction(formData: FormData): Promise<ActionResult> {
  return updateSticker(formData);
}

export async function deleteStickerAction(formData: FormData): Promise<ActionResult> {
  return deleteSticker(formData);
}
