import { z } from 'zod';

import {
  MAX_EMBED_DESCRIPTION_LENGTH,
  MAX_EMBED_FIELD_NAME_LENGTH,
  MAX_EMBED_FIELD_VALUE_LENGTH,
  MAX_EMBED_FIELDS,
  MAX_EMBED_FOOTER_LENGTH,
  MAX_EMBED_TITLE_LENGTH,
  MAX_EMBED_URL_LENGTH,
  MAX_MESSAGE_CONTENT_LENGTH,
  TEMPLATE_VARIABLES,
  type TemplateVariable,
} from './constants';

/** Valores das variáveis de template. Chaves ausentes ficam como `{chave}`. */
export type TemplateVars = Partial<Record<TemplateVariable, string | number>>;

const PLACEHOLDER_RE = /\{([a-zA-Z][a-zA-Z0-9]*)\}/g;
/** Mesma forma, sem `g`: `.test` de regex global carrega `lastIndex`. */
const HAS_PLACEHOLDER_RE = /\{[a-zA-Z][a-zA-Z0-9]*\}/;

/** `true` quando o texto tem ao menos um `{placeholder}` para renderizar. */
export function hasPlaceholder(value: string): boolean {
  return HAS_PLACEHOLDER_RE.test(value);
}

/**
 * Substitui `{user}`, `{server}`, `{memberCount}`, … pelos valores em `vars`.
 * Placeholders desconhecidos ou sem valor são mantidos literalmente para que
 * o autor perceba o erro no `/welcome test`.
 */
export function renderTemplate(template: string, vars: TemplateVars): string {
  return template.replace(PLACEHOLDER_RE, (match, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(vars, key)) return match;
    const value = vars[key as TemplateVariable];
    return value === undefined || value === null ? match : String(value);
  });
}

/** Lista os placeholders de um template que não são variáveis conhecidas. */
export function findUnknownPlaceholders(template: string): string[] {
  const known = new Set<string>(TEMPLATE_VARIABLES);
  const unknown = new Set<string>();
  for (const match of template.matchAll(PLACEHOLDER_RE)) {
    const key = match[1]!;
    if (!known.has(key)) unknown.add(key);
  }
  return [...unknown];
}

/** Cor de embed como inteiro RGB (0x000000–0xFFFFFF). Hex é só no CSS do painel. */
export const EmbedColorSchema = z.number().int().min(0).max(0xffffff);

export const EmbedTemplateSchema = z
  .object({
    title: z.string().max(MAX_EMBED_TITLE_LENGTH).optional(),
    description: z.string().max(MAX_EMBED_DESCRIPTION_LENGTH).optional(),
    /**
     * Link do card (o título vira clicável). Aceita `{url}` além de uma URL
     * literal: num anúncio de rede social o endereço só existe na hora de
     * renderizar. Quem monta o embed descarta o que não virou URL de verdade.
     */
    url: z
      .string()
      .max(MAX_EMBED_URL_LENGTH)
      .refine((value) => hasPlaceholder(value) || z.url().safeParse(value).success, {
        message: 'Informe uma URL ou um texto com {url}',
      })
      .optional(),
    /** `null` = usar `guild_settings.embed_color`. */
    color: EmbedColorSchema.nullable().default(null),
    fields: z
      .array(
        z.object({
          name: z.string().min(1).max(MAX_EMBED_FIELD_NAME_LENGTH),
          value: z.string().min(1).max(MAX_EMBED_FIELD_VALUE_LENGTH),
          inline: z.boolean().default(false),
        }),
      )
      .max(MAX_EMBED_FIELDS)
      .default([]),
    footer: z.string().max(MAX_EMBED_FOOTER_LENGTH).optional(),
    /** `'user_avatar'`/`'server_icon'` são resolvidos em runtime; senão URL. */
    thumbnail: z.union([z.enum(['user_avatar', 'server_icon']), z.url()]).optional(),
    image: z.url().optional(),
    timestamp: z.boolean().default(false),
  })
  .refine(
    (embed) => Boolean(embed.title || embed.description || embed.fields.length > 0 || embed.image),
    { message: 'O embed precisa ter título, descrição, campos ou imagem' },
  );
export type EmbedTemplate = z.infer<typeof EmbedTemplateSchema>;

/**
 * Mensagem configurável (boas-vindas, tags, painéis, DMs). Pelo menos um de
 * `content`/`embed`. Os textos aceitam as variáveis de `TEMPLATE_VARIABLES`.
 */
export const MessageTemplateSchema = z
  .object({
    content: z.string().max(MAX_MESSAGE_CONTENT_LENGTH).optional(),
    embed: EmbedTemplateSchema.optional(),
  })
  .refine((tpl) => Boolean(tpl.content?.trim()) || tpl.embed !== undefined, {
    message: 'Informe o texto da mensagem ou um embed',
  });
export type MessageTemplate = z.infer<typeof MessageTemplateSchema>;

/** Aplica `renderTemplate` em todos os textos de um `MessageTemplate`. */
export function renderMessageTemplate(tpl: MessageTemplate, vars: TemplateVars): MessageTemplate {
  const r = (s: string | undefined) => (s === undefined ? undefined : renderTemplate(s, vars));
  const out: MessageTemplate = {};
  if (tpl.content !== undefined) out.content = r(tpl.content);
  if (tpl.embed) {
    out.embed = {
      ...tpl.embed,
      title: r(tpl.embed.title),
      description: r(tpl.embed.description),
      url: r(tpl.embed.url),
      footer: r(tpl.embed.footer),
      fields: tpl.embed.fields.map((f) => ({
        ...f,
        name: renderTemplate(f.name, vars),
        value: renderTemplate(f.value, vars),
      })),
    };
  }
  return out;
}
