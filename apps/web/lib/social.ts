import 'server-only';

import {
  InternalApiError,
  SocialAccountInputSchema,
  type SocialAccountInput,
  type SocialOverview,
} from '@cobot/shared';
import { revalidatePath } from 'next/cache';

import { withAudit } from './audit';
import { defaultGuildId, requireGuildAccess } from './auth/require';
import { internalApi } from './internal-api';
import { toFieldErrors, type ActionResult } from './module-config';

const PATH = (guildId: string) => `/g/${guildId}/config/social`;

/** O bot fora do ar não pode derrubar a página: a lista vem vazia e o aviso sobe. */
export interface SocialPageData extends SocialOverview {
  /** Motivo de a lista ter vindo vazia; `null` quando deu tudo certo. */
  error: string | null;
}

export async function loadSocial(guildId: string): Promise<SocialPageData> {
  try {
    const overview = await internalApi().social(guildId);
    return { ...overview, error: null };
  } catch (error) {
    return {
      accounts: [],
      platforms: [],
      error:
        error instanceof InternalApiError
          ? `O bot não respondeu: ${error.message}`
          : 'O bot não respondeu.',
    };
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

function accountId(formData: FormData): string | null {
  const value = formData.get('accountId');
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Toda escrita passa pela API do bot, não pelo banco direto: é o processo do
 * bot que sabe se a plataforma tem credencial e se ele enxerga o canal. Salvar
 * uma conta que nunca anunciaria seria pior do que recusar na hora.
 */
function toActionResult(error: unknown): ActionResult {
  if (error instanceof InternalApiError) {
    const fieldErrors = Object.fromEntries(
      error.issues.map((issue) => [issue.path, issue.message]),
    );
    return {
      ok: false,
      message: error.message,
      ...(Object.keys(fieldErrors).length > 0 ? { fieldErrors } : {}),
    };
  }
  return { ok: false, message: 'Não foi possível falar com o bot.' };
}

export async function saveSocialAccount(formData: FormData): Promise<ActionResult> {
  const guildId = defaultGuildId();
  const session = await requireGuildAccess(guildId, 'admin');

  const parsed = SocialAccountInputSchema.safeParse(parseBody(formData.get('account')));
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Confira os campos marcados.',
      fieldErrors: toFieldErrors(parsed.error),
    };
  }
  const input: SocialAccountInput = parsed.data;
  const id = accountId(formData);

  let saved;
  try {
    saved = id
      ? await internalApi().updateSocialAccount(guildId, id, input)
      : await internalApi().createSocialAccount(guildId, input);
  } catch (error) {
    return toActionResult(error);
  }

  await withAudit(
    { id: session.user.id, tag: session.user.name },
    id ? 'social.account.update' : 'social.account.create',
    { type: 'social_account', id: saved.id },
    null,
    input,
  );
  revalidatePath(PATH(guildId));
  return {
    ok: true,
    message: id
      ? undefined
      : 'A primeira passada só marca o que já existe; o próximo post é que vira anúncio.',
  };
}

export async function removeSocialAccount(formData: FormData): Promise<ActionResult> {
  const guildId = defaultGuildId();
  const session = await requireGuildAccess(guildId, 'admin');

  const id = accountId(formData);
  if (!id) return { ok: false, message: 'Conta inválida.' };

  try {
    await internalApi().deleteSocialAccount(guildId, id);
  } catch (error) {
    return toActionResult(error);
  }

  await withAudit(
    { id: session.user.id, tag: session.user.name },
    'social.account.delete',
    { type: 'social_account', id },
  );
  revalidatePath(PATH(guildId));
  return { ok: true };
}

/** Botão `TESTAR`: manda um anúncio de mentira no canal configurado da conta. */
export async function testSocialAccount(formData: FormData): Promise<ActionResult> {
  const guildId = defaultGuildId();
  await requireGuildAccess(guildId, 'admin');

  const id = accountId(formData);
  if (!id) return { ok: false, message: 'Conta inválida.' };

  try {
    const result = await internalApi().testSocialAccount(guildId, id);
    return { ok: true, message: `Anúncio de exemplo enviado em <#${result.channelId}>.` };
  } catch (error) {
    return toActionResult(error);
  }
}
