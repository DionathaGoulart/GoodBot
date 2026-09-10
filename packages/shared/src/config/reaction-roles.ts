import { z } from 'zod';

import { REACTION_ROLE_MODES, REACTION_ROLE_STYLES } from '../constants';
import { MessageTemplateSchema } from '../templates';
import { emptyToNull, moduleConfigBase, SnowflakeSchema } from './common';

/** Limite do Discord: 25 botões (5×5) ou 25 opções num select. */
export const MAX_PANEL_ITEMS = 25;

/** Config global; os painéis ficam em `reaction_role_panels`/`_items`. */
export const ReactionRolesConfigSchema = z.object({
  ...moduleConfigBase,
  /** Confirmar em mensagem efêmera quando um cargo é adicionado/removido. */
  ephemeralFeedback: z.boolean().default(true),
  /** No estilo `reactions`, remover a reação do usuário após processar. */
  removeReactionAfter: z.boolean().default(false),
  maxPanels: z.number().int().min(1).max(100).default(25),
});
export type ReactionRolesConfig = z.infer<typeof ReactionRolesConfigSchema>;
export const DEFAULT_REACTION_ROLES_CONFIG: ReactionRolesConfig = ReactionRolesConfigSchema.parse(
  {},
);

/** Um cargo dentro de um painel, como o editor do painel web o envia. */
export const ReactionRoleItemInputSchema = z.object({
  roleId: SnowflakeSchema,
  /** Unicode ou `nome:id` de emoji customizado; `null` = sem emoji. */
  emoji: emptyToNull(z.string().trim().min(1).max(64)),
  label: z.string().trim().min(1, 'Informe o texto do botão').max(80),
  description: emptyToNull(z.string().trim().min(1).max(100)),
});
export type ReactionRoleItemInput = z.infer<typeof ReactionRoleItemInputSchema>;

/**
 * Painel completo vindo do editor (Etapa 15). A lista de itens viaja inteira:
 * o repositório troca todos de uma vez para `position` bater com a ordem que o
 * usuário vê.
 */
export const ReactionRolePanelInputSchema = z
  .object({
    channelId: SnowflakeSchema,
    mode: z.enum(REACTION_ROLE_MODES).default('toggle'),
    style: z.enum(REACTION_ROLE_STYLES).default('buttons'),
    content: MessageTemplateSchema,
    items: z
      .array(ReactionRoleItemInputSchema)
      .min(1, 'O painel precisa de pelo menos um cargo')
      .max(MAX_PANEL_ITEMS),
  })
  .superRefine((panel, ctx) => {
    const seen = new Set<string>();
    panel.items.forEach((item, index) => {
      if (seen.has(item.roleId)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Este cargo já está no painel',
          path: ['items', index, 'roleId'],
        });
      }
      seen.add(item.roleId);
      // No estilo `reactions` o emoji **é** o gatilho: sem ele o item não existe.
      if (panel.style === 'reactions' && !item.emoji) {
        ctx.addIssue({
          code: 'custom',
          message: 'No estilo por reação todo item precisa de emoji',
          path: ['items', index, 'emoji'],
        });
      }
    });
  });
export type ReactionRolePanelInput = z.infer<typeof ReactionRolePanelInputSchema>;
