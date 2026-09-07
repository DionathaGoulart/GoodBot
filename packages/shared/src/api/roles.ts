import { z } from 'zod';

import { PermissionNamesSchema } from './permissions';
import { SnowflakeSchema } from '../config/common';
import { MAX_REASON_LENGTH } from '../constants';

/** Nome de cargo: limite do Discord. */
export const MAX_ROLE_NAME_LENGTH = 100;

/**
 * Toda escrita da gestão de servidor carrega `actorId`: o Bearer diz que a
 * requisição veio do painel, não *quem* clicou. É com esse ID que o bot resolve
 * o nível e a hierarquia (PRD §9.2).
 */
export const actorFields = {
  actorId: SnowflakeSchema,
  /** Vai para o audit log do Discord. */
  reason: z.string().trim().max(MAX_REASON_LENGTH).optional(),
};

export const RoleWriteInputSchema = z.object({
  ...actorFields,
  name: z.string().trim().min(1).max(MAX_ROLE_NAME_LENGTH),
  /** Inteiro RGB; `0` = sem cor (o Discord pinta de cinza). */
  color: z.number().int().min(0).max(0xffffff).default(0),
  /** Mostra o cargo separado na lista de membros. */
  hoist: z.boolean().default(false),
  mentionable: z.boolean().default(false),
  permissions: PermissionNamesSchema.default([]),
});
export type RoleWriteInput = z.infer<typeof RoleWriteInputSchema>;

/** `▲`/`▼` da tabela: uma casa por clique, para não precisar de drag. */
export const RoleMoveInputSchema = z.object({
  ...actorFields,
  direction: z.enum(['up', 'down']),
});
export type RoleMoveInput = z.infer<typeof RoleMoveInputSchema>;

export const ActorInputSchema = z.object(actorFields);
export type ActorInput = z.infer<typeof ActorInputSchema>;

/** `POST /members/:userId/roles` — adiciona e remove numa tacada só. */
export const MemberRolesInputSchema = z
  .object({
    ...actorFields,
    add: z.array(SnowflakeSchema).max(50).default([]),
    remove: z.array(SnowflakeSchema).max(50).default([]),
  })
  .superRefine((input, ctx) => {
    if (input.add.length === 0 && input.remove.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['add'], message: 'Nada a alterar' });
    }
    const overlap = input.add.filter((id) => input.remove.includes(id));
    if (overlap.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['add'],
        message: 'O mesmo cargo não pode entrar e sair na mesma ação',
      });
    }
  });
export type MemberRolesInput = z.infer<typeof MemberRolesInputSchema>;
