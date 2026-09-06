import { z } from 'zod';

import { MAX_NAME_LENGTH } from '../constants';
import { MessageTemplateSchema } from '../templates';
import { moduleConfigBase, SnowflakeListSchema } from './common';

/** Config global; as tags ficam em `tags`. */
export const TagsConfigSchema = z.object({
  ...moduleConfigBase,
  /** Cargos que podem criar/editar tags (além de mods). Vazio = só mods. */
  managerRoleIds: SnowflakeListSchema,
  /** Qualquer membro pode usar `/tag <nome>`. */
  everyoneCanUse: z.boolean().default(true),
  maxTags: z.number().int().min(1).max(1_000).default(200),
  /** Cooldown por usuário para usar tags. */
  cooldownSeconds: z.number().int().min(0).max(300).default(3),
});
export type TagsConfig = z.infer<typeof TagsConfigSchema>;
export const DEFAULT_TAGS_CONFIG: TagsConfig = TagsConfigSchema.parse({});

/**
 * Uma tag no editor do painel. O nome é canonizado em minúsculas pelo
 * repositório (`normalizeTagName`), então aqui só barramos o que não pode
 * virar argumento de `/tag`.
 */
export const TagInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Informe o nome da tag')
    .max(MAX_NAME_LENGTH)
    .regex(/^[\p{L}\p{N}_-]+$/u, 'Use apenas letras, números, `_` ou `-`'),
  content: MessageTemplateSchema,
});
export type TagInput = z.infer<typeof TagInputSchema>;
