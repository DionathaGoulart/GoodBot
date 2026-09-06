'use client';

import * as React from 'react';
import { TEMPLATE_VARIABLES, type EmbedTemplate, type MessageTemplate } from '@cobot/shared';

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
}: {
  target: React.RefObject<HTMLTextAreaElement | null>;
  onInsert: (next: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {TEMPLATE_VARIABLES.map((variable) => (
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

export interface TemplateEditorProps {
  value: MessageTemplate | null;
  onChange: (value: MessageTemplate | null) => void;
  disabled?: boolean;
  embedColor: number;
  id?: string;
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
}: TemplateEditorProps) {
  const contentRef = React.useRef<HTMLTextAreaElement>(null);
  const descriptionRef = React.useRef<HTMLTextAreaElement>(null);

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
        <EmbedPreview template={value} embedColor={embedColor} />
      </div>
    </div>
  );
}
