import { z } from 'zod';

import { SnowflakeSchema } from '../config/common';

/**
 * `POST /guilds/:id/squads/guides`: o botão do painel web que publica as três
 * mensagens do bot (o guia fixado do `#buscar-squad`, o guia e os botões do
 * `#jogatinas`), ou reedita as que já estão no ar (PRD §5.11). Só admin. Os
 * canais são os salvos no config: publicar num canal que o config não conhece
 * deixaria o bot editando uma mensagem e a staff olhando para outra.
 */
export const PublishSquadGuidesInputSchema = z.object({
  actorId: SnowflakeSchema,
});
export type PublishSquadGuidesInput = z.infer<typeof PublishSquadGuidesInputSchema>;

export const PublishedSquadMessageSchema = z.object({
  channelId: SnowflakeSchema,
  messageId: SnowflakeSchema,
  /** `true` quando nasceu mensagem nova; `false` quando a do ar foi editada. */
  created: z.boolean(),
});
export type PublishedSquadMessage = z.infer<typeof PublishedSquadMessageSchema>;

/** `null` é "o canal dessa mensagem não está configurado": nada foi publicado. */
export const PublishSquadGuidesResultSchema = z.object({
  chatGuide: PublishedSquadMessageSchema.nullable(),
  deskGuide: PublishedSquadMessageSchema.nullable(),
  deskButtons: PublishedSquadMessageSchema.nullable(),
});
export type PublishSquadGuidesResult = z.infer<typeof PublishSquadGuidesResultSchema>;
