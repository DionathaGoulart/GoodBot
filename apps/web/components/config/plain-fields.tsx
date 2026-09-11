'use client';

import * as React from 'react';
import { IMAGE_REJECTION_MESSAGE, MAX_GUILD_IMAGE_BYTES, parseImageDataUrl } from '@goodbot/shared';
import { toast } from 'sonner';

import { Label } from '@/components/ui/label';

/**
 * Os campos das telas que **não** usam react-hook-form: as que editam o
 * Discord ao vivo (servidor, perfil do bot) em vez de um jsonb de módulo. Para
 * as de módulo, os campos amarrados ao formulário estão em `fields.tsx`.
 */

/**
 * Uma imagem do formulário tem três estados, e os três precisam existir:
 * `undefined` não mexe, `null` remove no Discord, a data URL troca.
 */
export type ImageDraft = string | null | undefined;

/** Campo bloqueado mostra o porquê onde o campo estaria (§8, §6.8). */
export function Blocked({ reason }: { reason: string }) {
  return <p className="border-2 border-warning p-3 text-xs text-warning-text">! {reason}</p>;
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      {hint ? <p className="text-xs opacity-60">{hint}</p> : null}
      {children}
    </div>
  );
}

/**
 * Imagem com preview na moldura de 2px do §6.2, e a mesma validação que a rota
 * do bot faz — o arquivo é recusado aqui antes de virar 11 MB de base64
 * subindo para a Vercel.
 *
 * `fallbackUrl` é o que fica valendo quando não há imagem própria: o avatar
 * global do bot aparece no lugar do "SEM IMAGEM" quando o servidor não tem um.
 */
export function ImageField({
  label,
  hint,
  currentUrl,
  fallbackUrl = null,
  draft,
  onChange,
  disabled,
  blocked,
  className,
}: {
  label: string;
  hint?: string;
  currentUrl: string | null;
  fallbackUrl?: string | null;
  draft: ImageDraft;
  onChange: (next: ImageDraft) => void;
  disabled: boolean;
  blocked: string | null;
  className: string;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const own = draft === undefined ? currentUrl : draft;
  const shown = own ?? fallbackUrl;

  const read = (file: File) => {
    if (file.size > MAX_GUILD_IMAGE_BYTES) {
      toast.error('ERRO', { description: IMAGE_REJECTION_MESSAGE.size });
      return;
    }
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      const url = String(reader.result);
      const parsed = parseImageDataUrl(url);
      if (!parsed.ok) {
        toast.error('ERRO', { description: IMAGE_REJECTION_MESSAGE[parsed.reason] });
        return;
      }
      onChange(url);
    });
    reader.readAsDataURL(file);
  };

  return (
    <Field label={label} hint={hint}>
      {blocked ? <Blocked reason={blocked} /> : null}
      <div className="flex flex-wrap items-start gap-4">
        <span className={`${className} flex items-center justify-center border-2 border-base-300`}>
          {shown ? (
            // Imagens do CDN do Discord e data URLs; `next/image` pediria host
            // liberado e não ganharia nada num preview.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shown} alt="" className="size-full object-cover" />
          ) : (
            <span className="screen-meta">SEM IMAGEM</span>
          )}
        </span>

        <div className="flex flex-col gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) read(file);
              // Zera o input: escolher o mesmo arquivo de novo tem que disparar.
              event.target.value = '';
            }}
          />
          <button
            type="button"
            className="icon-btn"
            disabled={disabled || blocked !== null}
            onClick={() => inputRef.current?.click()}
          >
            ESCOLHER
          </button>
          <button
            type="button"
            className="icon-btn"
            disabled={disabled || blocked !== null || own === null}
            onClick={() => onChange(null)}
          >
            REMOVER
          </button>
          {draft === undefined ? null : (
            <button type="button" className="icon-btn" onClick={() => onChange(undefined)}>
              DESFAZER
            </button>
          )}
        </div>
      </div>
    </Field>
  );
}
