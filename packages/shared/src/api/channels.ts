import { z } from 'zod';

import { GuildChannelSummarySchema } from './members';
import { PERMISSION_BITS } from './permissions';
import { actorFields } from './roles';
import { SnowflakeSchema, emptyToNull } from '../config/common';
import { MAX_SLOWMODE_SECONDS } from '../constants';

/** Nome e tópico: limites do Discord. */
export const MAX_CHANNEL_NAME_LENGTH = 100;
export const MAX_CHANNEL_TOPIC_LENGTH = 1024;

/**
 * Os `ChannelType` que o painel cria e edita. Fóruns, palcos e tópicos ficam
 * de fora: são configuráveis, mas exigem telas próprias que a v1 não tem.
 */
export const MANAGED_CHANNEL_TYPES = { text: 0, voice: 2, category: 4, announcement: 5 } as const;
export type ManagedChannelType = (typeof MANAGED_CHANNEL_TYPES)[keyof typeof MANAGED_CHANNEL_TYPES];

export const ManagedChannelTypeSchema = z.union([
  z.literal(MANAGED_CHANNEL_TYPES.text),
  z.literal(MANAGED_CHANNEL_TYPES.voice),
  z.literal(MANAGED_CHANNEL_TYPES.category),
  z.literal(MANAGED_CHANNEL_TYPES.announcement),
]);

/** Estado de uma permissão num override: herdar é a ausência dos dois bits. */
export const OVERRIDE_STATES = ['allow', 'deny', 'inherit'] as const;
export type OverrideState = (typeof OVERRIDE_STATES)[number];
export const OverrideStateSchema = z.enum(OVERRIDE_STATES);

/** Override básico por cargo (PRD §6.3): só ver e falar. */
export const ChannelOverrideSchema = z.object({
  roleId: SnowflakeSchema,
  view: OverrideStateSchema.default('inherit'),
  send: OverrideStateSchema.default('inherit'),
});
export type ChannelOverride = z.infer<typeof ChannelOverrideSchema>;

export const GuildChannelDetailSchema = GuildChannelSummarySchema.extend({
  topic: z.string().nullable(),
  nsfw: z.boolean(),
  slowmodeSeconds: z.number().int().min(0),
  /** Só os overrides de cargo; os de membro existem mas o painel não os mexe. */
  overrides: z.array(ChannelOverrideSchema),
});
export type GuildChannelDetail = z.infer<typeof GuildChannelDetailSchema>;

export const ChannelCreateInputSchema = z.object({
  ...actorFields,
  name: z.string().trim().min(1).max(MAX_CHANNEL_NAME_LENGTH),
  type: ManagedChannelTypeSchema,
  parentId: emptyToNull(SnowflakeSchema),
  topic: emptyToNull(z.string().trim().max(MAX_CHANNEL_TOPIC_LENGTH)),
  nsfw: z.boolean().default(false),
  slowmodeSeconds: z.number().int().min(0).max(MAX_SLOWMODE_SECONDS).default(0),
});
export type ChannelCreateInput = z.infer<typeof ChannelCreateInputSchema>;

/** Edição: o tipo de um canal não muda, então ele não está aqui. */
export const ChannelUpdateInputSchema = ChannelCreateInputSchema.omit({ type: true });
export type ChannelUpdateInput = z.infer<typeof ChannelUpdateInputSchema>;

export const SlowmodeInputSchema = z.object({
  ...actorFields,
  seconds: z.number().int().min(0).max(MAX_SLOWMODE_SECONDS),
});
export type SlowmodeInput = z.infer<typeof SlowmodeInputSchema>;

export const ChannelOverridesInputSchema = z.object({
  ...actorFields,
  overrides: z.array(ChannelOverrideSchema).max(50),
});
export type ChannelOverridesInput = z.infer<typeof ChannelOverridesInputSchema>;

/** Par `allow`/`deny` como o Discord guarda um override. */
export interface OverrideBits {
  allow: string;
  deny: string;
}

function apply(bits: bigint, flag: bigint, state: OverrideState): bigint {
  return state === 'inherit' ? bits : state === 'allow' ? bits | flag : bits;
}

/**
 * `{view, send}` → `{allow, deny}`. Sai daqui e vai igual para o discord.js e
 * para o teste: é a única tradução entre o vocabulário do painel e o do
 * Discord, e errar um lado dela abre canal fechado.
 */
export function overrideToBits(override: ChannelOverride): OverrideBits {
  let allow = 0n;
  let deny = 0n;
  for (const [state, flag] of [
    [override.view, PERMISSION_BITS.ViewChannel],
    [override.send, PERMISSION_BITS.SendMessages],
  ] as const) {
    allow = apply(allow, flag, state);
    if (state === 'deny') deny |= flag;
  }
  return { allow: allow.toString(), deny: deny.toString() };
}

function stateOf(allow: bigint, deny: bigint, flag: bigint): OverrideState {
  if ((deny & flag) === flag) return 'deny';
  if ((allow & flag) === flag) return 'allow';
  return 'inherit';
}

/** O caminho de volta, para o formulário abrir com o estado real do canal. */
export function bitsToOverride(roleId: string, bits: OverrideBits): ChannelOverride {
  let allow: bigint;
  let deny: bigint;
  try {
    allow = BigInt(bits.allow);
    deny = BigInt(bits.deny);
  } catch {
    allow = 0n;
    deny = 0n;
  }
  return {
    roleId,
    view: stateOf(allow, deny, PERMISSION_BITS.ViewChannel),
    send: stateOf(allow, deny, PERMISSION_BITS.SendMessages),
  };
}

/** Override que não nega nem libera nada não precisa existir no canal. */
export function isEmptyOverride(override: ChannelOverride): boolean {
  return override.view === 'inherit' && override.send === 'inherit';
}
