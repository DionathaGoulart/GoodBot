import { z } from 'zod';

import {
  type AutomodRuleType,
  MAX_BAN_DELETE_DAYS,
  MAX_MESSAGE_CONTENT_LENGTH,
  MAX_NAME_LENGTH,
  MAX_REASON_LENGTH,
  MAX_TIMEOUT_MS,
} from '../constants';
import { DurationMsSchema, SnowflakeListSchema } from './common';

// ── Ações ───────────────────────────────────────────────────────────────────

export const AutomodActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('delete') }),
  z.object({ type: z.literal('warn'), reason: z.string().max(MAX_REASON_LENGTH).optional() }),
  z.object({
    type: z.literal('timeout'),
    durationMs: DurationMsSchema.max(MAX_TIMEOUT_MS),
    reason: z.string().max(MAX_REASON_LENGTH).optional(),
  }),
  z.object({ type: z.literal('kick'), reason: z.string().max(MAX_REASON_LENGTH).optional() }),
  z.object({
    type: z.literal('ban'),
    deleteMessageDays: z.number().int().min(0).max(MAX_BAN_DELETE_DAYS).default(0),
    reason: z.string().max(MAX_REASON_LENGTH).optional(),
  }),
  z.object({ type: z.literal('notify_modlog') }),
  z.object({
    type: z.literal('dm_user'),
    message: z.string().min(1).max(MAX_MESSAGE_CONTENT_LENGTH).optional(),
  }),
]);
export type AutomodActionConfig = z.infer<typeof AutomodActionSchema>;

const PUNISHMENTS = new Set(['warn', 'timeout', 'kick', 'ban']);

export const AutomodActionsSchema = z
  .array(AutomodActionSchema)
  .min(1, 'A regra precisa de pelo menos uma ação')
  .max(7)
  .refine((actions) => new Set(actions.map((a) => a.type)).size === actions.length, {
    message: 'Cada ação só pode aparecer uma vez',
  })
  .refine((actions) => actions.filter((a) => PUNISHMENTS.has(a.type)).length <= 1, {
    message: 'Só uma punição (warn/timeout/kick/ban) por regra',
  });

// ── Config específico por tipo ──────────────────────────────────────────────

export const SpamRuleConfigSchema = z.object({
  /** N mensagens em X segundos por usuário. */
  maxMessages: z.number().int().min(2).max(50).default(5),
  intervalSeconds: z.number().int().min(1).max(120).default(5),
  /** N mensagens idênticas consecutivas (0 = desativado). */
  maxDuplicates: z.number().int().min(0).max(20).default(3),
  /** Contar por canal em vez de por servidor. */
  perChannel: z.boolean().default(false),
});

export const LinksRuleConfigSchema = z.object({
  allowedDomains: z.array(z.string().min(1).max(253).toLowerCase()).max(200).default([]),
  blockInvites: z.boolean().default(true),
  /** Só bloquear convites (links comuns passam). */
  invitesOnly: z.boolean().default(false),
  allowedChannelIds: SnowflakeListSchema,
});

export const CapsRuleConfigSchema = z.object({
  /** % mínimo de maiúsculas entre as letras da mensagem. */
  minPercent: z.number().int().min(1).max(100).default(70),
  /** Tamanho mínimo (em letras) para avaliar. */
  minLength: z.number().int().min(1).max(500).default(10),
});

export const WORD_MATCH_MODES = ['exact', 'wildcard', 'regex'] as const;
export const WordsRuleConfigSchema = z
  .object({
    mode: z.enum(WORD_MATCH_MODES).default('exact'),
    words: z.array(z.string().min(1).max(200)).min(1).max(500),
    caseSensitive: z.boolean().default(false),
    /** Ignorar acentos/diacríticos na comparação. */
    normalizeDiacritics: z.boolean().default(true),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.mode !== 'regex') return;
    cfg.words.forEach((pattern, i) => {
      try {
        new RegExp(pattern, 'u');
      } catch {
        ctx.addIssue({ code: 'custom', message: `Regex inválido: ${pattern}`, path: ['words', i] });
      }
    });
  });

export const MentionsRuleConfigSchema = z.object({
  /** Menções (usuários + cargos) por mensagem. */
  maxMentions: z.number().int().min(1).max(50).default(5),
  /** Bloquear @everyone/@here de quem não tem permissão nativa. */
  blockEveryone: z.boolean().default(true),
  countRoles: z.boolean().default(true),
});

export const RAID_ACTIONS = ['kick', 'ban', 'require_account_age'] as const;
export const RaidRuleConfigSchema = z.object({
  /** N entradas em X segundos ativam o modo raid. */
  joins: z.number().int().min(3).max(500).default(10),
  intervalSeconds: z.number().int().min(5).max(600).default(30),
  raidModeMinutes: z.number().int().min(1).max(1_440).default(10),
  /** O que fazer com novas entradas durante o modo raid. */
  action: z.enum(RAID_ACTIONS).default('kick'),
  /** Usado por `require_account_age`. */
  minAccountAgeDays: z.number().int().min(1).max(365).default(7),
  alertModlog: z.boolean().default(true),
});

export const AUTOMOD_RULE_CONFIG_SCHEMAS = {
  spam: SpamRuleConfigSchema,
  links: LinksRuleConfigSchema,
  caps: CapsRuleConfigSchema,
  words: WordsRuleConfigSchema,
  mentions: MentionsRuleConfigSchema,
  raid: RaidRuleConfigSchema,
} as const satisfies Record<AutomodRuleType, z.ZodType>;

// ── Regra completa ──────────────────────────────────────────────────────────

const ruleBase = {
  name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
  enabled: z.boolean().default(true),
  /** Menor = avaliada antes. */
  priority: z.number().int().min(0).max(1_000).default(100),
  actions: AutomodActionsSchema,
  exemptRoleIds: SnowflakeListSchema,
  exemptChannelIds: SnowflakeListSchema,
};

const variant = <T extends AutomodRuleType, S extends z.ZodType>(type: T, config: S) =>
  z.object({ ...ruleBase, type: z.literal(type), config });

const SpamRuleSchema = variant(
  'spam',
  SpamRuleConfigSchema.default(SpamRuleConfigSchema.parse({})),
);
const LinksRuleSchema = variant(
  'links',
  LinksRuleConfigSchema.default(LinksRuleConfigSchema.parse({})),
);
const CapsRuleSchema = variant(
  'caps',
  CapsRuleConfigSchema.default(CapsRuleConfigSchema.parse({})),
);
/** Filtro de palavras não tem default útil: a lista é obrigatória. */
const WordsRuleSchema = variant('words', WordsRuleConfigSchema);
const MentionsRuleSchema = variant(
  'mentions',
  MentionsRuleConfigSchema.default(MentionsRuleConfigSchema.parse({})),
);
const RaidRuleSchema = variant(
  'raid',
  RaidRuleConfigSchema.default(RaidRuleConfigSchema.parse({})),
);

/** Ações que não fazem sentido para regras avaliadas em `guildMemberAdd`. */
const MESSAGE_ONLY_ACTIONS = new Set(['delete']);

/**
 * Regra de automod (linha de `automod_rules`): `type` decide o formato de
 * `config`; `actions` são executadas em sequência (PRD §5.2).
 */
export const AutomodRuleSchema = z
  .discriminatedUnion('type', [
    SpamRuleSchema,
    LinksRuleSchema,
    CapsRuleSchema,
    WordsRuleSchema,
    MentionsRuleSchema,
    RaidRuleSchema,
  ])
  .refine(
    (rule) => rule.type !== 'raid' || !rule.actions.some((a) => MESSAGE_ONLY_ACTIONS.has(a.type)),
    { message: 'Regra anti-raid não pode apagar mensagens', path: ['actions'] },
  );
export type AutomodRule = z.infer<typeof AutomodRuleSchema>;
export type AutomodRuleInput = z.input<typeof AutomodRuleSchema>;
export type AutomodRuleConfigOf<T extends AutomodRuleType> = z.infer<
  (typeof AUTOMOD_RULE_CONFIG_SCHEMAS)[T]
>;
