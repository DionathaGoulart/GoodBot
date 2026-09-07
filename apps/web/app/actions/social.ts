'use server';

import { removeSocialAccount, saveSocialAccount, testSocialAccount } from '@/lib/social';

import type { ActionResult } from '@/lib/module-config';

/**
 * Ações da tela de redes sociais (PRD §5.8). Cascas finas sobre `lib/social`,
 * como as demais: permissão e auditoria moram lá, junto da escrita.
 */

export async function saveSocialAccountAction(formData: FormData): Promise<ActionResult> {
  return saveSocialAccount(formData);
}

export async function deleteSocialAccountAction(formData: FormData): Promise<ActionResult> {
  return removeSocialAccount(formData);
}

export async function testSocialAccountAction(formData: FormData): Promise<ActionResult> {
  return testSocialAccount(formData);
}
