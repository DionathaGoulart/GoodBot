import { renderMessageTemplate } from '@cobot/shared';

import type { MessageTemplate, TemplateVariable } from '@cobot/shared';

import { colorToHex } from './discord-options';

/** Valores de exemplo do preview — o bot usa ele mesmo quando manda o teste. */
export const PREVIEW_VARS: Record<TemplateVariable, string> = {
  user: 'membro',
  mention: '@membro',
  tag: 'membro#0001',
  id: '123456789012345678',
  server: 'SERVIDOR',
  memberCount: '1204',
  ordinal: '1204º',
  // Publicação (§5.8): o mesmo preview serve à tela de redes sociais.
  title: 'Título da publicação',
  url: 'https://exemplo.com/publicacao',
  author: 'Canal de exemplo',
  thumbnail: 'https://exemplo.com/capa.jpg',
  platform: 'YouTube',
  kind: 'vídeo',
  headline: 'publicou um vídeo novo',
};

/**
 * §9 — o embed do Discord desenhado em CSS, para o autor ver o resultado sem
 * mandar mensagem. Não imita o Discord: imita o styleguide, com a barrinha
 * lateral colorida que é a única coisa que o Discord realmente empresta.
 */
export function EmbedPreview({
  template,
  embedColor,
  vars,
}: {
  template: MessageTemplate | null;
  /** Cor padrão da guild, usada quando o embed não define a dele. */
  embedColor: number;
  /** Sobrescreve os valores de exemplo (a tela de redes sociais troca por tipo). */
  vars?: Partial<Record<TemplateVariable, string>>;
}) {
  if (!template) {
    return (
      <p className="border-2 border-dashed border-base-300 p-4 text-sm opacity-60">
        Sem mensagem configurada.
      </p>
    );
  }

  const rendered = renderMessageTemplate(template, { ...PREVIEW_VARS, ...vars });
  const color = colorToHex(rendered.embed?.color ?? embedColor);

  return (
    <div className="flex flex-col gap-2">
      {rendered.content ? <p className="text-sm whitespace-pre-wrap">{rendered.content}</p> : null}
      {rendered.embed ? (
        <div className="flex border-2 border-base-300 bg-base-100">
          <div aria-hidden className="w-1.5 shrink-0" style={{ backgroundColor: color }} />
          <div className="flex min-w-0 flex-col gap-2 p-3">
            {rendered.embed.title ? (
              <p className="text-sm font-black uppercase tracking-wide">{rendered.embed.title}</p>
            ) : null}
            {rendered.embed.description ? (
              <p className="text-sm whitespace-pre-wrap opacity-90">{rendered.embed.description}</p>
            ) : null}
            {rendered.embed.fields.length > 0 ? (
              <dl className="grid gap-2 sm:grid-cols-2">
                {rendered.embed.fields.map((field, index) => (
                  <div key={`${field.name}-${index}`} className="flex flex-col gap-0.5">
                    <dt className="section-label">{field.name}</dt>
                    <dd className="text-sm opacity-90">{field.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {rendered.embed.footer ? (
              <p className="screen-meta">{rendered.embed.footer}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
