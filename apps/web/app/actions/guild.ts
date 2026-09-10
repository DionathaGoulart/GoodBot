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
import type { BanListQuery, GuildBanPage, GuildChannelDetail } from '@goodbot/shared';

/**
 * As ações da gestão de servidor (Etapa 16). Cascas finas sobre o `lib/`
 * correspondente: a checagem de permissão e a auditoria moram lá, junto da
 * escrita, para nenhum caminho novo escapar delas.
 */

// ── membros ─────────────────────────────────────────────────────────────────

export async function punishMemberAction(
  guildId: string,
  formData: FormData,
): Promise<ActionResult> {
  return punishMember(guildId, formData);
}

export async function setMemberRolesAction(
  guildId: string,
  formData: FormData,
): Promise<ActionResult> {
  return setMemberRoles(guildId, formData);
}

// ── cargos ──────────────────────────────────────────────────────────────────

export async function saveRoleAction(guildId: string, formData: FormData): Promise<ActionResult> {
  return saveRole(guildId, formData);
}

export async function deleteRoleAction(guildId: string, formData: FormData): Promise<ActionResult> {
  return removeRole(guildId, formData);
}

export async function moveRoleAction(guildId: string, formData: FormData): Promise<ActionResult> {
  return moveRole(guildId, formData);
}

// ── canais ──────────────────────────────────────────────────────────────────

export async function loadChannelDetailAction(
  guildId: string,
  channelId: string,
): Promise<{ ok: true; detail: GuildChannelDetail } | { ok: false; message: string }> {
  return loadChannelDetail(guildId, channelId);
}

export async function saveChannelAction(
  guildId: string,
  formData: FormData,
): Promise<ActionResult> {
  return saveChannel(guildId, formData);
}

export async function deleteChannelAction(
  guildId: string,
  formData: FormData,
): Promise<ActionResult> {
  return removeChannel(guildId, formData);
}

export async function setSlowmodeAction(
  guildId: string,
  formData: FormData,
): Promise<ActionResult> {
  return setSlowmode(guildId, formData);
}

export async function toggleChannelLockAction(
  guildId: string,
  formData: FormData,
): Promise<ActionResult> {
  return toggleChannelLock(guildId, formData);
}

export async function setChannelOverridesAction(
  guildId: string,
  formData: FormData,
): Promise<ActionResult> {
  return setChannelOverrides(guildId, formData);
}

// ── servidor e banidos ──────────────────────────────────────────────────────

export async function saveGuildProfileAction(
  guildId: string,
  formData: FormData,
): Promise<ActionResult> {
  return saveGuildProfile(guildId, formData);
}

export async function unbanUserAction(guildId: string, formData: FormData): Promise<ActionResult> {
  return unbanUser(guildId, formData);
}

export async function loadMoreBansAction(
  guildId: string,
  query: Partial<BanListQuery>,
): Promise<{ ok: true; page: GuildBanPage } | { ok: false; message: string }> {
  return loadMoreBans(guildId, query);
}

// ── convites, eventos e emojis (Etapa 25) ───────────────────────────────────

export async function createInviteAction(
  guildId: string,
  formData: FormData,
): Promise<ActionResult> {
  return createInvite(guildId, formData);
}

export async function deleteInviteAction(
  guildId: string,
  formData: FormData,
): Promise<ActionResult> {
  return deleteInvite(guildId, formData);
}

export async function saveScheduledEventAction(
  guildId: string,
  formData: FormData,
): Promise<ActionResult> {
  return saveScheduledEvent(guildId, formData);
}

export async function deleteScheduledEventAction(
  guildId: string,
  formData: FormData,
): Promise<ActionResult> {
  return deleteScheduledEvent(guildId, formData);
}

export async function createEmojiAction(
  guildId: string,
  formData: FormData,
): Promise<ActionResult> {
  return createEmoji(guildId, formData);
}

export async function updateEmojiAction(
  guildId: string,
  formData: FormData,
): Promise<ActionResult> {
  return updateEmoji(guildId, formData);
}

export async function deleteEmojiAction(
  guildId: string,
  formData: FormData,
): Promise<ActionResult> {
  return deleteEmoji(guildId, formData);
}

export async function createStickerAction(
  guildId: string,
  formData: FormData,
): Promise<ActionResult> {
  return createSticker(guildId, formData);
}

export async function updateStickerAction(
  guildId: string,
  formData: FormData,
): Promise<ActionResult> {
  return updateSticker(guildId, formData);
}

export async function deleteStickerAction(
  guildId: string,
  formData: FormData,
): Promise<ActionResult> {
  return deleteSticker(guildId, formData);
}
