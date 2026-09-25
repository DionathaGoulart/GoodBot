import { z } from 'zod';

import { moduleConfigBase, NullableSnowflakeSchema } from './common';

/** Os três canais do módulo, na ordem em que o painel os mostra. */
const SQUAD_CHANNEL_FIELDS = ['chatChannelId', 'deskChannelId', 'agendaChannelId'] as const;

/**
 * Config do módulo (`module_configs.config`, jsonb), PRD §5.11. Cargo e sala são
 * estado do Discord; jogatinas e cards têm tabela (`lfg_sessions`).
 *
 * Sem `.strict()` de propósito: a linha de guild que usou uma versão antiga do
 * módulo ainda tem `searchRoleId`, `panelChannelId`, `gameNames`... no jsonb, e
 * esses campos precisam sumir no parse em vez de derrubar o config inteiro para
 * o default.
 */
export const SquadsConfigSchema = z
  .object({
    ...moduleConfigBase,
    /**
     * `#buscar-squad`: chat livre de todo mundo. O bot fixa o guia e posta ali
     * os cards de "procuro agora" e os de DIVULGAR.
     */
    chatChannelId: NullableSnowflakeSchema,
    /** `#jogatinas`: só o bot escreve. O guia e a mensagem dos botões. */
    deskChannelId: NullableSnowflakeSchema,
    /**
     * `#agenda`: só o bot escreve. Uma mensagem por jogatina marcada, com a
     * lista de quem vai e uma thread.
     */
    agendaChannelId: NullableSnowflakeSchema,
    /**
     * Categoria das salas. Pertence ao módulo: voz ali com nome `Squad <nome
     * grego>` é apagada ao esvaziar.
     */
    categoryId: NullableSnowflakeSchema,
    /** `Bora`: opt-in, mencionado nos cards. O cargo do bot precisa estar acima. */
    notifyRoleId: NullableSnowflakeSchema,
    /** Vagas padrão do card e da jogatina, e o `userLimit` da sala. */
    roomSize: z
      .number()
      .int()
      .min(2, 'Uma sala tem pelo menos 2 pessoas.')
      .max(10, 'Uma sala tem no máximo 10 pessoas.')
      .default(4),
    /**
     * Janela de tolerância: a sala vazia só é apagada depois disso, para uma
     * queda de conexão não punir quem volta em meio minuto. 0 = na hora.
     */
    graceMinutes: z
      .number()
      .int()
      .min(0, 'A tolerância vai de 0 a 10 minutos.')
      .max(10, 'A tolerância vai de 0 a 10 minutos.')
      .default(2),
    /** As três mensagens do bot. Gravadas pelo bot, não pelo painel web. */
    chatGuideMessageId: NullableSnowflakeSchema,
    deskGuideMessageId: NullableSnowflakeSchema,
    deskButtonsMessageId: NullableSnowflakeSchema,
  })
  .superRefine((config, ctx) => {
    // Um canal em dois papéis mistura o chat com o que só o bot escreve.
    const seen = new Set<string>();
    for (const field of SQUAD_CHANNEL_FIELDS) {
      const id = config[field];
      if (id === null) continue;
      if (seen.has(id)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Os três canais do módulo precisam ser diferentes.',
          path: [field],
        });
      } else {
        seen.add(id);
      }
    }
  });
export type SquadsConfig = z.infer<typeof SquadsConfigSchema>;
export const DEFAULT_SQUADS_CONFIG: SquadsConfig = SquadsConfigSchema.parse({});
