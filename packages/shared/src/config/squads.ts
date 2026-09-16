import { z } from 'zod';

import {
  MAX_NAME_LENGTH,
  MAX_SQUAD_BLOCK_LABEL_LENGTH,
  MAX_SQUAD_FIELD_LABEL_LENGTH,
  MAX_SQUAD_FIELD_OPTIONS,
  MAX_SQUAD_GAME_FIELDS,
  MAX_SQUAD_GROUP_SIZE,
  MAX_SQUAD_OPTION_LENGTH,
  MAX_SQUAD_PARTY_SIZE,
  MAX_SQUAD_TEXT_ANSWER_LENGTH,
  MIN_SQUAD_SIZE,
  SQUAD_AVAILABILITY_MAX,
  SQUAD_BLOCKS,
  SQUAD_FIELD_MATCH,
  SQUAD_FIELD_TYPES,
  SQUAD_PROFILE_STATUSES,
} from '../constants';
import { moduleConfigBase, NullableSnowflakeSchema, SnowflakeListSchema } from './common';

// ── Faixas da grade ─────────────────────────────────────────────────────────

export const SquadBlockKeySchema = z.enum(SQUAD_BLOCKS);

/**
 * Uma faixa do dia. Ela não atravessa a meia-noite (`startHour < endHour`, e
 * `endHour` 24 é a meia-noite seguinte): assim uma célula da grade começa e
 * termina no mesmo dia, e a conta da próxima sessão nunca precisa decidir a
 * qual dia pertence um "22h às 2h".
 */
export const SquadBlockSchema = z
  .object({
    key: SquadBlockKeySchema,
    label: z
      .string()
      .trim()
      .min(1, 'Dê um nome à faixa.')
      .max(
        MAX_SQUAD_BLOCK_LABEL_LENGTH,
        `O nome da faixa tem no máximo ${String(MAX_SQUAD_BLOCK_LABEL_LENGTH)} caracteres.`,
      ),
    startHour: z
      .number()
      .int()
      .min(0, 'Hora de início entre 0 e 23.')
      .max(23, 'Hora de início entre 0 e 23.'),
    endHour: z
      .number()
      .int()
      .min(1, 'Hora de fim entre 1 e 24.')
      .max(24, 'Hora de fim entre 1 e 24.'),
  })
  .refine((block) => block.startHour < block.endHour, {
    message: 'A faixa precisa terminar depois de começar, sem passar da meia-noite.',
    path: ['endHour'],
  });
export type SquadBlockConfig = z.infer<typeof SquadBlockSchema>;

/**
 * "Madrugada" é o começo do próprio dia (0h às 6h): a madrugada de sábado é a
 * noite de sexta para sábado. Quem desenha a grade precisa dizer isso.
 */
export const DEFAULT_SQUAD_BLOCKS: readonly SquadBlockConfig[] = [
  { key: 'morning', label: 'Manhã', startHour: 6, endHour: 12 },
  { key: 'afternoon', label: 'Tarde', startHour: 12, endHour: 18 },
  { key: 'evening', label: 'Noite', startHour: 18, endHour: 24 },
  { key: 'night', label: 'Madrugada', startHour: 0, endHour: 6 },
];

/**
 * As quatro faixas, sempre na ordem de `SQUAD_BLOCKS`. O painel edita horário
 * e rótulo, nunca a chave nem a ordem: o índice é o que está gravado nas
 * grades dos perfis.
 */
export const SquadBlocksSchema = z
  .array(SquadBlockSchema)
  .length(SQUAD_BLOCKS.length, 'A grade tem exatamente quatro faixas.')
  .superRefine((blocks, ctx) => {
    blocks.forEach((block, index) => {
      if (block?.key !== SQUAD_BLOCKS[index]) {
        ctx.addIssue({
          code: 'custom',
          message: 'As faixas precisam ficar na ordem: manhã, tarde, noite, madrugada.',
          path: [index, 'key'],
        });
      }
    });
  })
  // Função, e não o array: cada parse ganha a sua cópia, e mexer no config de
  // uma guild nunca altera o default das outras.
  .default(() => DEFAULT_SQUAD_BLOCKS.map((block) => ({ ...block })));

// ── Config do módulo ────────────────────────────────────────────────────────

/** Config do módulo (`module_configs.config`, jsonb). Jogos ficam em `squad_games`. */
export const SquadsConfigSchema = z.object({
  ...moduleConfigBase,
  /** Canal de busca: recebe a mensagem fixa e as threads de proposta. */
  searchChannelId: NullableSnowflakeSchema,
  /** A mensagem fixa do canal de busca. Gravada pelo bot, não pelo painel. */
  searchMessageId: NullableSnowflakeSchema,
  /** Categoria onde nascem os canais de texto dos squads. */
  categoryId: NullableSnowflakeSchema,
  /**
   * Voices reservados por jogatina. É um pool, e não um voice por squad, porque
   * o Discord só deixa renomear canal duas vezes a cada dez minutos e cada
   * canal a mais pesa no teto de 500.
   */
  voicePoolIds: SnowflakeListSchema,
  /**
   * Sem voice livre no pool, cria um voice só para a jogatina, na categoria dos
   * squads, e apaga quando ele esvazia depois do início (ou no fim). Desligado,
   * a jogatina fica sem sala e o lembrete avisa.
   */
  temporaryVoices: z.boolean().default(true),
  /** Cargo pingado quando uma proposta sai. */
  pingRoleId: NullableSnowflakeSchema,
  blocks: SquadBlocksSchema,
  /** Proposta sem nenhum aceite morre depois disso. */
  proposalTtlHours: z.number().int().min(1).max(720).default(72),
  /** A mesma dupla não é reproposta antes disso; 0 = pode repropor na hora. */
  reproposeCooldownDays: z.number().int().min(0).max(90).default(14),
  /**
   * Antecedência do lembrete e da reserva do voice; 0 = na hora da jogatina.
   * Jogatina marcada para dentro desse prazo já sai lembrada e com sala.
   */
  reminderMinutesBefore: z.number().int().min(0).max(240).default(30),
  /** Quanto dura uma jogatina: é quando o voice reservado volta para o pool. */
  sessionHours: z.number().int().min(1).max(12).default(3),
  /** Jogatinas futuras que um squad pode ter marcadas ao mesmo tempo. */
  maxUpcomingSessions: z.number().int().min(1).max(10).default(5),
  /** Semanas seguidas sem sinal de vida (jogatina, "vou", presença) até o squad ser questionado. */
  inactiveWeeks: z.number().int().min(1).max(52).default(4),
  /** Em quantos squads uma pessoa pode estar ao mesmo tempo. */
  maxSquadsPerUser: z.number().int().min(1).max(5).default(1),
  /** Nome do canal de texto do squad; `{name}` é trocado pelo nome do squad. */
  channelNaming: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .refine(
      (pattern) => pattern.includes('{name}'),
      'O padrão precisa ter {name}, senão todo squad ganha o mesmo nome de canal.',
    )
    .default('squad-{name}'),
});
export type SquadsConfig = z.infer<typeof SquadsConfigSchema>;
export const DEFAULT_SQUADS_CONFIG: SquadsConfig = SquadsConfigSchema.parse({});

// ── Jogos e campos ──────────────────────────────────────────────────────────

export const SQUAD_FIELD_KEY_RE = /^[a-z0-9_]{1,32}$/;

/**
 * Chave de um campo. Vira pedaço de `custom_id` no modal do bot e chave do
 * jsonb de respostas, daí o alfabeto curto. `constructor` e `__proto__` passam
 * no padrão, mas já existem em todo objeto JS: a resposta seria lida do
 * protótipo, não do jogador.
 */
export const SquadFieldKeySchema = z
  .string()
  .regex(
    SQUAD_FIELD_KEY_RE,
    'A chave usa só letras minúsculas, números e _, com até 32 caracteres.',
  )
  .refine((key) => !(key in Object.prototype), 'Esta chave é reservada. Escolha outra.');

export const SquadFieldTypeSchema = z.enum(SQUAD_FIELD_TYPES);
export const SquadFieldMatchSchema = z.enum(SQUAD_FIELD_MATCH);

/** Uma pergunta do jogo ("Plataforma", "Dificuldade"), no jsonb `squad_games.fields`. */
export const SquadGameFieldSchema = z
  .object({
    key: SquadFieldKeySchema,
    label: z
      .string()
      .trim()
      .min(1, 'Informe o rótulo do campo.')
      .max(
        MAX_SQUAD_FIELD_LABEL_LENGTH,
        `O rótulo tem no máximo ${String(MAX_SQUAD_FIELD_LABEL_LENGTH)} caracteres.`,
      ),
    type: SquadFieldTypeSchema,
    options: z
      .array(
        z
          .string()
          .trim()
          .min(1, 'Opção vazia.')
          .max(
            MAX_SQUAD_OPTION_LENGTH,
            `Uma opção tem no máximo ${String(MAX_SQUAD_OPTION_LENGTH)} caracteres.`,
          ),
      )
      .max(
        MAX_SQUAD_FIELD_OPTIONS,
        `No máximo ${String(MAX_SQUAD_FIELD_OPTIONS)} opções por campo.`,
      )
      .default([]),
    required: z.boolean().default(false),
    match: SquadFieldMatchSchema.default('none'),
  })
  .superRefine((field, ctx) => {
    const options: unknown[] = Array.isArray(field.options) ? field.options : [];
    if (field.type === 'text') {
      if (options.length > 0) {
        ctx.addIssue({
          code: 'custom',
          message: 'Campo de texto livre não tem opções.',
          path: ['options'],
        });
      }
      if (field.match !== 'none') {
        ctx.addIssue({
          code: 'custom',
          message: 'Texto livre não entra no match. Use "nenhum".',
          path: ['match'],
        });
      }
      return;
    }
    if (options.length === 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'Adicione pelo menos uma opção.',
        path: ['options'],
      });
    }
    const seen = new Set<unknown>();
    options.forEach((option, index) => {
      if (seen.has(option)) {
        ctx.addIssue({ code: 'custom', message: 'Opção repetida.', path: ['options', index] });
      }
      seen.add(option);
    });
  });
export type SquadGameField = z.infer<typeof SquadGameFieldSchema>;
export type SquadGameFieldInput = z.input<typeof SquadGameFieldSchema>;

/** Um jogo no editor do painel (linha de `squad_games`). */
export const SquadGameInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Informe o nome do jogo.').max(MAX_NAME_LENGTH),
    /** Teto do squad inteiro. */
    groupSize: z
      .number()
      .int()
      .min(MIN_SQUAD_SIZE, `Um squad tem pelo menos ${String(MIN_SQUAD_SIZE)} jogadores.`)
      .max(
        MAX_SQUAD_GROUP_SIZE,
        `Um squad tem no máximo ${String(MAX_SQUAD_GROUP_SIZE)} jogadores.`,
      ),
    /** Quantos jogam juntos numa partida; é o tamanho da turma que o match propõe. */
    partySize: z
      .number()
      .int()
      .min(MIN_SQUAD_SIZE, `Uma party tem pelo menos ${String(MIN_SQUAD_SIZE)} jogadores.`)
      .max(
        MAX_SQUAD_PARTY_SIZE,
        `Uma party tem no máximo ${String(MAX_SQUAD_PARTY_SIZE)} jogadores.`,
      ),
    enabled: z.boolean().default(true),
    fields: z
      .array(SquadGameFieldSchema)
      .max(
        MAX_SQUAD_GAME_FIELDS,
        `No máximo ${String(MAX_SQUAD_GAME_FIELDS)} campos por jogo: é o que cabe num modal do Discord.`,
      )
      .default([]),
  })
  .superRefine((game, ctx) => {
    if (
      typeof game.partySize === 'number' &&
      typeof game.groupSize === 'number' &&
      game.partySize > game.groupSize
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'A party não pode ser maior que o squad.',
        path: ['partySize'],
      });
    }
    const seen = new Set<string>();
    (Array.isArray(game.fields) ? game.fields : []).forEach((field, index) => {
      const key = field?.key;
      if (typeof key !== 'string') return;
      if (seen.has(key)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Esta chave já existe neste jogo.',
          path: ['fields', index, 'key'],
        });
      }
      seen.add(key);
    });
  });
export type SquadGameInput = z.infer<typeof SquadGameInputSchema>;

/** Nome de um squad: vai no embed e, com `channelNaming`, no canal de texto. */
export const SquadNameSchema = z
  .string()
  .trim()
  .min(1, 'Informe o nome do squad.')
  .max(MAX_NAME_LENGTH);

// ── Perfil e respostas ──────────────────────────────────────────────────────

/** `select` e `text` guardam uma string; `tags`, uma lista. */
export type SquadAnswerValue = string | string[];
/** `{ chave do campo: resposta }`, o jsonb `squad_profiles.answers`. */
export type SquadAnswers = Record<string, SquadAnswerValue>;
/** O que a validação das respostas precisa saber de um campo. */
export type SquadAnswerField = Pick<SquadGameField, 'key' | 'type' | 'options' | 'required'>;

/**
 * Formato cru das respostas: chave válida, string ou lista de strings, com
 * tetos. O que cada chave aceita depende dos campos do jogo, que moram no
 * banco; essa conferência é a de `validateAnswers`.
 */
export const SquadAnswersSchema = z
  .record(
    SquadFieldKeySchema,
    z.union([
      z.string().trim().max(MAX_SQUAD_OPTION_LENGTH),
      z.array(z.string().trim().max(MAX_SQUAD_OPTION_LENGTH)).max(MAX_SQUAD_FIELD_OPTIONS),
    ]),
  )
  .refine(
    (answers) => Object.keys(answers).length <= MAX_SQUAD_GAME_FIELDS,
    'Respostas demais para um jogo.',
  );

/** Grade semanal: bit `dia * 4 + faixa`; 0 = nenhuma faixa marcada. */
export const SquadAvailabilitySchema = z
  .number()
  .int()
  .min(0, 'Grade de disponibilidade inválida.')
  .max(SQUAD_AVAILABILITY_MAX, 'Grade de disponibilidade inválida.');

/** O jogador escolhe procurar ou pausar; `in_squad` é só o bot quem põe. */
export const SquadProfileInputStatusSchema = z.enum(SQUAD_PROFILE_STATUSES).exclude(['in_squad']);

/**
 * O perfil que o jogador salva, por jogo. `answers` passa aqui só pelo
 * formato; quem salva confere contra os campos do jogo com `validateAnswers`.
 */
export const SquadProfileInputSchema = z.object({
  availability: SquadAvailabilitySchema,
  answers: SquadAnswersSchema.default(() => ({})),
  status: SquadProfileInputStatusSchema.default('searching'),
});
export type SquadProfileInput = z.infer<typeof SquadProfileInputSchema>;

const REQUIRED_MESSAGE = 'Campo obrigatório.';

/** Mensagem de tipo: ausente é "obrigatório", o resto é resposta no formato errado. */
const answerTypeError = (issue: { input?: unknown }) =>
  issue.input === undefined ? REQUIRED_MESSAGE : 'Resposta em formato inválido.';

function answerValueSchema(field: SquadAnswerField): z.ZodType<SquadAnswerValue> {
  const inOptions = (value: string) => field.options.includes(value);
  switch (field.type) {
    case 'select':
      return z
        .string({ error: answerTypeError })
        .trim()
        .refine(inOptions, 'Escolha uma das opções do campo.');
    case 'tags':
      return z
        .array(z.string().trim().refine(inOptions, 'Escolha só opções do campo.'), {
          error: answerTypeError,
        })
        .min(1, 'Escolha pelo menos uma opção.')
        .transform((values) => [...new Set(values)]);
    case 'text':
      return z
        .string({ error: answerTypeError })
        .trim()
        .min(1, REQUIRED_MESSAGE)
        .max(
          MAX_SQUAD_TEXT_ANSWER_LENGTH,
          `No máximo ${String(MAX_SQUAD_TEXT_ANSWER_LENGTH)} caracteres.`,
        );
  }
}

const isBlankAnswer = (value: unknown) =>
  (typeof value === 'string' && value.trim() === '') ||
  (Array.isArray(value) && value.length === 0);

/**
 * Schema das respostas de um jogo, montado a partir dos campos dele.
 *
 * Resposta em branco (`''` ou lista vazia) de um campo conhecido conta como
 * ausente antes de validar: é o que o Discord manda quando o jogador deixa um
 * input do modal vazio ou desmarca tudo num select, e para um campo opcional
 * isso é "não respondeu", não um erro. Num campo obrigatório vira "Campo
 * obrigatório.". Chave que o jogo não tem é recusada: resposta órfã sobraria
 * no jsonb e poderia voltar a pesar no match se alguém recriasse o campo.
 */
export function answersSchemaFor(fields: readonly SquadAnswerField[]): z.ZodType<SquadAnswers> {
  const known = new Set(fields.map((field) => field.key));
  const shape = Object.fromEntries(
    fields.map((field) => {
      const value = answerValueSchema(field);
      return [field.key, field.required ? value : value.optional()];
    }),
  );
  return z.preprocess(
    (raw) =>
      raw !== null && typeof raw === 'object' && !Array.isArray(raw)
        ? Object.fromEntries(
            Object.entries(raw).filter(([key, value]) => !(known.has(key) && isBlankAnswer(value))),
          )
        : raw,
    z.strictObject(shape, {
      error: (issue) =>
        issue.code === 'unrecognized_keys'
          ? 'Resposta para um campo que este jogo não tem.'
          : 'As respostas precisam ser um objeto.',
    }),
  ) as z.ZodType<SquadAnswers>;
}

/**
 * Confere as respostas de um perfil contra os campos do jogo. Devolve o
 * resultado do `safeParse` para quem chama decidir a forma do erro: o bot
 * transforma em mensagem efêmera, o painel aponta o campo pelo `path`.
 */
export function validateAnswers(
  fields: readonly SquadAnswerField[],
  answers: unknown,
): z.ZodSafeParseResult<SquadAnswers> {
  return answersSchemaFor(fields).safeParse(answers);
}
