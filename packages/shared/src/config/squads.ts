import { z } from 'zod';

import { LFG_MAX_GAME_NAMES, MAX_NAME_LENGTH } from '../constants';
import { moduleConfigBase, NullableSnowflakeSchema } from './common';

/**
 * Forma de comparar o nome de um jogo com a atividade do rich presence: sem
 * `™`/`®`, sem diferenciar caixa e com espaços colapsados. O Discord mostra
 * `HELLDIVERS™ 2`, mas a staff digita `Helldivers 2`, e as duas precisam ser o
 * mesmo jogo.
 */
export function normalizeGameName(name: string): string {
  return name.replace(/[™®]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Nomes de jogo cujo rich presence dispara o aviso "buscar squad?". Repetido
 * (pela forma normalizada) conta uma vez só, e fica a primeira grafia. Vazia
 * desliga o aviso automático; o toggle manual continua valendo.
 */
const SquadGameNamesSchema = z
  .array(
    z
      .string()
      .trim()
      .max(MAX_NAME_LENGTH, `Um nome de jogo tem no máximo ${String(MAX_NAME_LENGTH)} caracteres.`)
      .refine((name) => normalizeGameName(name) !== '', 'Informe o nome do jogo.'),
  )
  .max(LFG_MAX_GAME_NAMES, `No máximo ${String(LFG_MAX_GAME_NAMES)} jogos.`)
  .transform((names) => {
    const seen = new Set<string>();
    return names.filter((name) => {
      const key = normalizeGameName(name);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  })
  // Função, e não o array: cada parse ganha a sua cópia, e mexer no config de
  // uma guild nunca altera o default das outras.
  .default(() => ['HELLDIVERS™ 2']);

/**
 * Config do módulo (`module_configs.config`, jsonb). O módulo não tem tabela:
 * cargo, sala e jogatina são estado do Discord (PRD §5.11).
 *
 * Sem `.strict()` de propósito: a linha de guild que usou o módulo antigo ainda
 * tem `searchChannelId`, `blocks`, `voicePoolIds`... no jsonb, e esses campos
 * precisam sumir no parse em vez de derrubar o config inteiro para o default.
 */
export const SquadsConfigSchema = z
  .object({
    ...moduleConfigBase,
    /** `Buscando Squad`: hoisted, é a única marca de "estou buscando". */
    searchRoleId: NullableSnowflakeSchema,
    /** `Sem Aviso de Squad`: quem tem nunca recebe o aviso automático. */
    optOutRoleId: NullableSnowflakeSchema,
    /** Canal de texto do painel fixo com as salas abertas. */
    panelChannelId: NullableSnowflakeSchema,
    /** A mensagem do painel. Gravada pelo bot, não pelo painel web. */
    panelMessageId: NullableSnowflakeSchema,
    /**
     * Categoria das salas. Pertence ao módulo: voz ali com nome `Squad <nome
     * grego>` é apagada ao esvaziar.
     */
    categoryId: NullableSnowflakeSchema,
    /**
     * Canal de texto da agenda: cada jogatina marcada é uma mensagem do bot ali,
     * com a lista de quem vai e uma thread. Sem ele, MARCAR JOGATINA recusa.
     */
    agendaChannelId: NullableSnowflakeSchema,
    /** Voz fixo `➕ Criar Squad` (join-to-create). Nunca é apagado. */
    createChannelId: NullableSnowflakeSchema,
    /** Teto de gente por sala, aplicado pelo `userLimit` do canal. */
    roomSize: z
      .number()
      .int()
      .min(2, 'Uma sala tem pelo menos 2 pessoas.')
      .max(10, 'Uma sala tem no máximo 10 pessoas.')
      .default(4),
    /**
     * Janela de tolerância: sair da voz só tira o cargo e apaga a sala depois
     * disso, para uma queda de conexão não punir quem volta em meio minuto.
     * 0 = na hora.
     */
    graceMinutes: z
      .number()
      .int()
      .min(0, 'A tolerância vai de 0 a 10 minutos.')
      .max(10, 'A tolerância vai de 0 a 10 minutos.')
      .default(2),
    /** Quem liga a busca e não entra em voz nesse prazo perde o cargo. */
    searchTtlMinutes: z
      .number()
      .int()
      .min(15, 'A busca dura pelo menos 15 minutos.')
      .max(720, 'A busca dura no máximo 12 horas (720 minutos).')
      .default(120),
    gameNames: SquadGameNamesSchema,
  })
  .superRefine((config, ctx) => {
    // Um cargo nos dois papéis faz o toggle de um desligar o outro.
    if (config.searchRoleId !== null && config.searchRoleId === config.optOutRoleId) {
      ctx.addIssue({
        code: 'custom',
        message: 'O cargo de busca e o de sem aviso precisam ser diferentes.',
        path: ['optOutRoleId'],
      });
    }
  });
export type SquadsConfig = z.infer<typeof SquadsConfigSchema>;
export const DEFAULT_SQUADS_CONFIG: SquadsConfig = SquadsConfigSchema.parse({});
