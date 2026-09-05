import { z } from 'zod';

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
