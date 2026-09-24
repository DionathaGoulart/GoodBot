import { z } from 'zod';

import {
  LFG_MAX_SLOTS,
  LFG_MIN_SLOTS,
  LFG_NOTE_MAX_LENGTH,
  LFG_VISIBILITIES,
} from '../constants';

/** Até onde o "quando" vai: `depois de amanhã às 21:30` cabe com folga. */
export const LFG_WHEN_MAX_LENGTH = 40;

/**
 * As vagas como o modal as entrega: texto. Vazio é "o tamanho da sala", que só
 * o config da guild sabe, então sai `undefined` e quem chama completa.
 */
const SlotsFieldSchema = z
  .string()
  .trim()
  .transform((raw, ctx) => {
    if (raw === '') return undefined;
    const slots = Number(raw);
    if (!Number.isInteger(slots) || slots < LFG_MIN_SLOTS || slots > LFG_MAX_SLOTS) {
      ctx.addIssue({
        code: 'custom',
        message:
          `Vagas é um número de ${String(LFG_MIN_SLOTS)} a ${String(LFG_MAX_SLOTS)}, ` +
          'contando você.',
      });
      return z.NEVER;
    }
    return slots;
  });

/**
 * O MARCAR JOGATINA (modal do painel ou `/squad agendar`). O "quando" é lido
 * depois por `parseWhen`, que precisa do fuso da guild; aqui só o tamanho.
 * A visibilidade vem do botão ABERTA ou FECHADA que segue o modal.
 */
export const ScheduleSessionInputSchema = z.object({
  when: z
    .string()
    .trim()
    .min(1, 'Diga quando é a jogatina.')
    .max(LFG_WHEN_MAX_LENGTH, 'Esse "quando" ficou longo demais.'),
  slots: SlotsFieldSchema,
  note: z
    .string()
    .trim()
    .max(LFG_NOTE_MAX_LENGTH, `A nota tem no máximo ${String(LFG_NOTE_MAX_LENGTH)} caracteres.`)
    .transform((note) => (note === '' ? null : note)),
  visibility: z.enum(LFG_VISIBILITIES),
});
export type ScheduleSessionInput = z.input<typeof ScheduleSessionInputSchema>;
export type ScheduleSession = z.output<typeof ScheduleSessionInputSchema>;
