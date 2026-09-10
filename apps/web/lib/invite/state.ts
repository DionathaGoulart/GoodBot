import 'server-only';

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { INVITE_FLOWS, INVITE_STATE_TTL_MS, type InviteFlow } from '@goodbot/shared';
import { z } from 'zod';

import { env } from '@/lib/env';

/**
 * O `state` do OAuth de convite.
 *
 * Ele carrega o fluxo (`invite` ou `demo`) porque o Discord não conta ao bot
 * por onde a pessoa veio. Isso faz do `state` uma **decisão de autorização**:
 * quem conseguisse escrever `demo` — ou, pior, um status qualquer — ganharia
 * atendimento sem passar pela fila. Por isso ele é assinado com o
 * `AUTH_SECRET` e vale por poucos minutos (`INVITE_STATE_TTL_MS`).
 *
 * Formato: `<payload base64url>.<hmac-sha256 base64url>`.
 */
const PayloadSchema = z.object({
  /** Fluxo. Abreviado porque o `state` viaja na query do Discord. */
  f: z.enum(INVITE_FLOWS),
  /** Emissão, em ms. */
  t: z.number().int().positive(),
  /** Nonce: dois `state` do mesmo fluxo no mesmo ms não saem iguais. */
  n: z.string().min(1).max(32),
});

export interface InviteState {
  flow: InviteFlow;
  issuedAt: number;
}

function sign(payload: string): string {
  return createHmac('sha256', env().AUTH_SECRET).update(payload).digest('base64url');
}

export function signInviteState(flow: InviteFlow, now: number = Date.now()): string {
  const payload = Buffer.from(
    JSON.stringify({ f: flow, t: now, n: randomBytes(9).toString('base64url') }),
  ).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

/**
 * Devolve o fluxo assinado, ou `null` se o `state` foi adulterado, expirou ou
 * simplesmente não é nosso. Quem chama trata `null` como recusa — nunca como
 * "assume o padrão".
 */
export function verifyInviteState(
  raw: string | null | undefined,
  now: number = Date.now(),
): InviteState | null {
  if (!raw) return null;

  const separator = raw.lastIndexOf('.');
  if (separator <= 0) return null;
  const payload = raw.slice(0, separator);
  const signature = raw.slice(separator + 1);

  const expected = Buffer.from(sign(payload));
  const received = Buffer.from(signature);
  // `timingSafeEqual` exige o mesmo tamanho; tamanho diferente já é recusa.
  if (expected.length !== received.length) return null;
  if (!timingSafeEqual(expected, received)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  const result = PayloadSchema.safeParse(parsed);
  if (!result.success) return null;

  const age = now - result.data.t;
  // O futuro também é recusado: um `state` com `t` adiantado seria um jeito de
  // fabricar validade eterna se a assinatura algum dia vazasse.
  if (age < 0 || age > INVITE_STATE_TTL_MS) return null;

  return { flow: result.data.f, issuedAt: result.data.t };
}
