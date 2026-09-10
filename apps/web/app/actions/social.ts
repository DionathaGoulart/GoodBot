'use server';

import {
  removeSocialAccount,
  resolveSocialChannel,
  saveSocialAccount,
  testSocialAccount,
} from '@/lib/social';

import type { ResolveChannelResult } from '@/lib/social';
import type { ActionResult } from '@/lib/module-config';

/**
 * Ações da tela de redes sociais (PRD §5.8). Cascas finas sobre `lib/social`,
 * como as demais: permissão e auditoria moram lá, junto da escrita.
 */

export async function saveSocialAccountAction(
  guildId: string,
  formData: FormData,
): Promise<ActionResult> {
  return saveSocialAccount(guildId, formData);
}

export async function deleteSocialAccountAction(
  guildId: string,
  formData: FormData,
): Promise<ActionResult> {
  return removeSocialAccount(guildId, formData);
}

export async function testSocialAccountAction(
  guildId: string,
  formData: FormData,
): Promise<ActionResult> {
  return testSocialAccount(guildId, formData);
}

export async function resolveSocialChannelAction(
  guildId: string,
  input: string,
): Promise<ResolveChannelResult> {
  return resolveSocialChannel(guildId, input);
}
