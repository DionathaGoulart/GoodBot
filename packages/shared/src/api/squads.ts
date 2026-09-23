import { z } from 'zod';

import { SnowflakeSchema } from '../config/common';

/**
 * `POST /guilds/:id/squads/panel`: o botão do painel web que publica o painel
 * fixo das salas, ou reedita o que já está no ar (PRD §5.11). Só admin. O
 * canal é o `panelChannelId` salvo: publicar num canal que o config não conhece
 * deixaria o bot editando uma mensagem e a staff olhando para outra.
 */
export const PublishSquadPanelInputSchema = z.object({
  actorId: SnowflakeSchema,
});
export type PublishSquadPanelInput = z.infer<typeof PublishSquadPanelInputSchema>;

export const PublishSquadPanelResultSchema = z.object({
  channelId: SnowflakeSchema,
  messageId: SnowflakeSchema,
  /** `true` quando nasceu mensagem nova; `false` quando a do ar foi editada. */
  created: z.boolean(),
});
export type PublishSquadPanelResult = z.infer<typeof PublishSquadPanelResultSchema>;
