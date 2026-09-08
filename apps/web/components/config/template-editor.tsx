'use client';

import * as React from 'react';
import {
  TEMPLATE_VARIABLES,
  type EmbedTemplate,
  type MessageTemplate,
  type TemplateVariable,
} from '@cobot/shared';

import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

import { EmbedPreview } from './embed-preview';

const EMPTY_EMBED: EmbedTemplate = { color: null, fields: [], timestamp: false };

/** Insere `{variavel}` na posição do cursor, sem comer o que já estava escrito. */
export function insertAt(text: string, start: number, end: number, snippet: string): string {
  return `${text.slice(0, start)}${snippet}${text.slice(end)}`;
}

function VariableBar({
  target,
  onInsert,
  disabled,
  variables,
}: {
  target: React.RefObject<HTMLTextAreaElement | null>;
  onInsert: (next: string) => void;
  disabled?: boolean;
  variables: readonly TemplateVariable[];
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {variables.map((variable) => (
        <button
          key={variable}
          type="button"
          disabled={disabled}
          className="icon-btn"
          onClick={() => {
            const element = target.current;
            if (!element) return;
            const snippet = `{${variable}}`;
            const start = element.selectionStart ?? element.value.length;
            const end = element.selectionEnd ?? start;
            onInsert(insertAt(element.value, start, end, snippet));
            // O cursor volta logo depois do que acabou de ser inserido.
            requestAnimationFrame(() => {
              element.focus();
              element.setSelectionRange(start + snippet.length, start + snippet.length);
            });
          }}
        >
          {`{${variable}}`}
        </button>
      ))}
    </div>
  );
}

/**
 * Um jeito de ver o mesmo template. A tela de redes sociais tem três (vídeo,
 * short, live), porque `{headline}` e `{kind}` mudam a frase inteira; as demais
 * telas têm um só e a barra de troca nem aparece.
 */
export interface TemplatePreviewMode {
  id: string;
  label: string;
  vars: Partial<Record<TemplateVariable, string>>;
}

export interface TemplateEditorProps {
  value: MessageTemplate | null;
  onChange: (value: MessageTemplate | null) => void;
  disabled?: boolean;
  embedColor: number;
  id?: string;
  /** Quais variáveis a barra oferece; o padrão é todas. */
  variables?: readonly TemplateVariable[];
  previewModes?: TemplatePreviewMode[];
}

/**
 * §6.4 — editor de mensagem com variáveis: textarea mono, barra de variáveis
 * que insere no cursor e preview do embed ao lado (§9). O valor é o mesmo
 * `MessageTemplate` que o bot manda para o Discord.
 */
export function TemplateEditor({
  value,
  onChange,
  disabled,
  embedColor,
  id,
  variables = TEMPLATE_VARIABLES,
  previewModes,
}: TemplateEditorProps) {
  const contentRef = React.useRef<HTMLTextAreaElement>(null);
  const descriptionRef = React.useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = React.useState(0);
  const preview = previewModes?.[Math.min(mode, previewModes.length - 1)];

  const template = value ?? {};
  const patch = (next: Partial<MessageTemplate>) => onChange({ ...template, ...next });
  const patchEmbed = (next: Partial<EmbedTemplate>) =>
    patch({ embed: { ...EMPTY_EMBED, ...template.embed, ...next } });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label className="section-label" htmlFor={id}>
            TEXTO DA MENSAGEM
          </label>
          <Textarea
            id={id}
            ref={contentRef}
            rows={4}
            disabled={disabled}
            value={template.content ?? ''}
            onChange={(event) =>
              patch({ content: event.target.value === '' ? undefined : event.target.value })
            }
          />
          <VariableBar
            target={contentRef}
            disabled={disabled}
            variables={variables}
            onInsert={(next) => patch({ content: next === '' ? undefined : next })}
          />
        </div>

        <label className="flex items-center justify-between gap-4 border-t-2 border-base-300 pt-4">
          <span className="section-label">USAR EMBED</span>
          <Switch
            disabled={disabled}
            checked={template.embed !== undefined}
            onCheckedChange={(checked) =>
              patch({ embed: checked ? { ...EMPTY_EMBED, ...template.embed } : undefined })
            }
          />
        </label>

        {template.embed ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <label className="section-label" htmlFor={`${id}-title`}>
                TÍTULO
              </label>
              <Input
                id={`${id}-title`}
                disabled={disabled}
                value={template.embed.title ?? ''}
                onChange={(event) =>
                  patchEmbed({ title: event.target.value === '' ? undefined : event.target.value })
                }
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="section-label" htmlFor={`${id}-description`}>
                DESCRIÇÃO
              </label>
              <Textarea
                id={`${id}-description`}
                ref={descriptionRef}
                rows={5}
                disabled={disabled}
                value={template.embed.description ?? ''}
                onChange={(event) =>
                  patchEmbed({
                    description: event.target.value === '' ? undefined : event.target.value,
                  })
                }
              />
              <VariableBar
                target={descriptionRef}
                disabled={disabled}
                variables={variables}
                onInsert={(next) => patchEmbed({ description: next === '' ? undefined : next })}
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="section-label" htmlFor={`${id}-footer`}>
                RODAPÉ
              </label>
              <Input
                id={`${id}-footer`}
                disabled={disabled}
                value={template.embed.footer ?? ''}
                onChange={(event) =>
                  patchEmbed({ footer: event.target.value === '' ? undefined : event.target.value })
                }
              />
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <p className="section-label">PREVIEW</p>
        {previewModes && previewModes.length > 1 ? (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tipo do preview">
            {previewModes.map((option, index) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={index === mode}
                className={
                  index === mode ? 'icon-btn border-accent text-accent-text' : 'icon-btn'
                }
                onClick={() => setMode(index)}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}
        <EmbedPreview template={value} embedColor={embedColor} vars={preview?.vars} />
      </div>
    </div>
  );
}
