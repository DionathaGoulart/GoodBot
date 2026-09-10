import { MANAGED_CHANNEL_TYPES, PERMISSION_NAMES } from '@goodbot/shared';
import { z } from 'zod';

import type { ManagedChannelType, PermissionName } from '@goodbot/shared';

/**
 * O `guild.yaml` descreve o servidor por **nome**, nunca por ID. Dois motivos:
 * o repositório é público e um ID identifica a guild de quem o escreveu, e um
 * spec sem ID pode ser aplicado em mais de um servidor sem edição nenhuma.
 * Os IDs são resolvidos em tempo de execução, contra o estado real da guild.
 */

/** `#e74c3c`, `e74c3c` ou o inteiro RGB puro — tudo vira inteiro. */
const ColorSchema = z
  .union([
    z
      .string()
      .trim()
      .regex(/^#?[0-9a-fA-F]{6}$/u),
    z.number().int().min(0).max(0xffffff),
  ])
  .transform((value) =>
    typeof value === 'number' ? value : Number.parseInt(value.replace('#', ''), 16),
  );

const PermissionNameSchema = z.enum(PERMISSION_NAMES as [PermissionName, ...PermissionName[]]);

export const RoleSpecSchema = z.object({
  name: z.string().trim().min(1).max(100),
  color: ColorSchema.default(0),
  /** Mostra o cargo separado na lista de membros. */
  hoist: z.boolean().default(false),
  mentionable: z.boolean().default(false),
  permissions: z.array(PermissionNameSchema).default([]),
});
export type RoleSpec = z.infer<typeof RoleSpecSchema>;

/**
 * A API do bot só expõe `view` e `send` por override (PRD §6.3), então o spec
 * expõe exatamente isso. Prometer mais aqui seria mentir sobre o que o apply
 * consegue escrever.
 */
export const OverrideSpecSchema = z.object({
  /** Nome do cargo, ou `@everyone`. */
  role: z.string().trim().min(1),
  view: z.enum(['allow', 'deny', 'inherit']).default('inherit'),
  send: z.enum(['allow', 'deny', 'inherit']).default('inherit'),
});
export type OverrideSpec = z.infer<typeof OverrideSpecSchema>;

const CHANNEL_TYPE_NAMES = {
  text: MANAGED_CHANNEL_TYPES.text,
  voice: MANAGED_CHANNEL_TYPES.voice,
  announcement: MANAGED_CHANNEL_TYPES.announcement,
} as const satisfies Record<string, ManagedChannelType>;

export type ChannelTypeName = keyof typeof CHANNEL_TYPE_NAMES;

const ChannelTypeSchema = z
  .enum(Object.keys(CHANNEL_TYPE_NAMES) as [ChannelTypeName, ...ChannelTypeName[]])
  .transform((name) => CHANNEL_TYPE_NAMES[name]);

export const ChannelSpecSchema = z.object({
  name: z.string().trim().min(1).max(100),
  type: ChannelTypeSchema.default(MANAGED_CHANNEL_TYPES.text),
  topic: z.string().trim().max(1024).nullable().default(null),
  nsfw: z.boolean().default(false),
  /** Slowmode em segundos. */
  slowmode: z.number().int().min(0).max(21_600).default(0),
  overrides: z.array(OverrideSpecSchema).max(50).default([]),
});
export type ChannelSpec = z.infer<typeof ChannelSpecSchema>;

export const CategorySpecSchema = z.object({
  name: z.string().trim().min(1).max(100),
  overrides: z.array(OverrideSpecSchema).max(50).default([]),
  channels: z.array(ChannelSpecSchema).default([]),
});
export type CategorySpec = z.infer<typeof CategorySpecSchema>;

/**
 * A ordem das listas é significativa: cargos vão de cima para baixo na
 * hierarquia, canais na ordem em que aparecem na categoria.
 */
export const GuildSpecSchema = z.object({
  /** Só para quem lê o arquivo se situar; não é escrito na guild. */
  name: z.string().trim().optional(),
  roles: z.array(RoleSpecSchema).default([]),
  /** Canais fora de qualquer categoria. */
  channels: z.array(ChannelSpecSchema).default([]),
  categories: z.array(CategorySpecSchema).default([]),
});
export type GuildSpec = z.infer<typeof GuildSpecSchema>;

/** Nome reservado: resolve para o cargo cujo ID é o próprio ID da guild. */
export const EVERYONE = '@everyone';
