'use client';

import * as React from 'react';
import { useFormContext, type ControllerRenderProps, type FieldValues } from 'react-hook-form';

import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

import { colorToHex, hexToColor, TEXT_CHANNEL_TYPES } from './discord-options';
import { DiscordPicker } from './discord-picker';
import { DurationInput } from './duration-input';
import { TemplateEditor, type TemplatePreviewMode } from './template-editor';

import type { MessageTemplate, TemplateVariable } from '@goodbot/shared';

/**
 * Os campos das telas de configuração. Todos falam com o react-hook-form pelo
 * nome (`escalation.steps.0.warns`), então as páginas ficam declarativas e a
 * amarração de label/descrição/erro do §6.4 mora num lugar só.
 */
export interface FieldProps {
  name: string;
  label: string;
  description?: string;
  required?: boolean;
}

type RenderField = ControllerRenderProps<FieldValues, string>;

function Field({
  name,
  label,
  description,
  required,
  children,
}: FieldProps & { children: (field: RenderField) => React.ReactNode }) {
  return (
    <FormField
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>
            {label}
            {required ? <span className="text-accent-text"> *</span> : null}
          </FormLabel>
          {description ? <FormDescription>{description}</FormDescription> : null}
          <FormControl>{children(field)}</FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function TextField({
  placeholder,
  ...props
}: FieldProps & { placeholder?: string }): React.ReactElement {
  return (
    <Field {...props}>
      {(field) => (
        <Input {...field} value={(field.value as string | null) ?? ''} placeholder={placeholder} />
      )}
    </Field>
  );
}

export function TextAreaField({
  rows = 3,
  ...props
}: FieldProps & { rows?: number }): React.ReactElement {
  return (
    <Field {...props}>
      {(field) => <Textarea {...field} rows={rows} value={(field.value as string | null) ?? ''} />}
    </Field>
  );
}

/**
 * Uma lista de strings (domínios, palavras, nomes de jogo) editada como
 * textarea, uma por linha. Linha vazia some ao salvar.
 */
export function LinesField({
  name,
  label,
  description,
  required,
  rows = 6,
}: FieldProps & { rows?: number }): React.ReactElement {
  const { watch, setValue, getFieldState, formState } = useFormContext();
  const value = (watch(name) as string[] | undefined) ?? [];
  // Estado local para o usuário poder digitar linhas em branco sem que elas
  // desapareçam a cada tecla.
  const [text, setText] = React.useState(value.join('\n'));
  // Só ressincronizamos numa troca de nome (a regra do automod mudou): `value`
  // vem do form, `text` é o rascunho. Ajustar em render (e não num efeito) é o
  // caminho recomendado pelo React para estado derivado de prop.
  const [syncedName, setSyncedName] = React.useState(name);
  if (syncedName !== name) {
    setSyncedName(name);
    setText(value.join('\n'));
  }
  // O erro de uma linha mora em `name.N`; o da lista inteira, em `name`.
  const { error } = getFieldState(name, formState);
  const message =
    error?.message ??
    (Array.isArray(error)
      ? (error as ({ message?: string } | undefined)[]).find((item) => item?.message)?.message
      : undefined);

  return (
    <div className="flex flex-col gap-1.5">
      <label className="section-label" htmlFor={name}>
        {label}
        {required ? <span className="text-accent-text"> *</span> : null}
      </label>
      {description ? <p className="text-xs opacity-60">{description}</p> : null}
      <textarea
        id={name}
        rows={rows}
        className="field-textarea"
        disabled={formState.disabled}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setValue(
            name,
            event.target.value
              .split('\n')
              .map((line) => line.trim())
              .filter(Boolean),
            { shouldDirty: true, shouldValidate: true },
          );
        }}
      />
      {message ? (
        <p className="text-[10px] uppercase tracking-[0.2em] text-error-text">{message}</p>
      ) : null}
    </div>
  );
}

export function NumberField({
  min,
  max,
  suffix,
  ...props
}: FieldProps & { min?: number; max?: number; suffix?: string }): React.ReactElement {
  return (
    <Field {...props}>
      {(field) => (
        <div className="flex items-center gap-2">
          <Input
            {...field}
            type="number"
            min={min}
            max={max}
            value={String(field.value ?? '')}
            // O valor tem que sair número: os schemas usam `z.number().int()`.
            onChange={(event) =>
              field.onChange(event.target.value === '' ? '' : Number(event.target.value))
            }
          />
          {suffix ? <span className="screen-meta shrink-0">{suffix}</span> : null}
        </div>
      )}
    </Field>
  );
}

/** §6.4 — o switch fica à direita do label, na mesma linha. */
export function SwitchField({ name, label, description }: FieldProps): React.ReactElement {
  return (
    <FormField
      name={name}
      render={({ field }) => (
        <FormItem className="flex-row items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <FormLabel>{label}</FormLabel>
            {description ? <FormDescription>{description}</FormDescription> : null}
          </div>
          <FormControl>
            <Switch
              checked={Boolean(field.value)}
              disabled={field.disabled}
              onCheckedChange={field.onChange}
            />
          </FormControl>
        </FormItem>
      )}
    />
  );
}

export function SelectField({
  options,
  ...props
}: FieldProps & { options: { value: string; label: string }[] }): React.ReactElement {
  return (
    <Field {...props}>
      {(field) => (
        <Select
          value={String(field.value ?? '')}
          disabled={field.disabled}
          onValueChange={field.onChange}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </Field>
  );
}

/**
 * Canal ou cargo. `multiple` guarda `string[]`; o modo único guarda
 * `string | null`, que é o formato de `NullableSnowflakeSchema`.
 */
export function DiscordField({
  kind,
  multiple = false,
  channelTypes = TEXT_CHANNEL_TYPES,
  placeholder,
  ...props
}: FieldProps & {
  kind: 'channel' | 'role';
  multiple?: boolean;
  channelTypes?: number[];
  placeholder?: string;
}): React.ReactElement {
  return (
    <Field {...props}>
      {(field) => (
        <DiscordPicker
          kind={kind}
          multiple={multiple}
          channelTypes={channelTypes}
          placeholder={placeholder}
          disabled={field.disabled}
          value={
            multiple
              ? ((field.value as string[] | null) ?? [])
              : field.value
                ? [field.value as string]
                : []
          }
          onChange={(next) => field.onChange(multiple ? next : (next[0] ?? null))}
        />
      )}
    </Field>
  );
}

export function DurationField({
  max,
  ...props
}: FieldProps & { max?: number }): React.ReactElement {
  return (
    <Field {...props}>
      {(field) => (
        <DurationInput
          value={Number(field.value ?? 0)}
          max={max}
          disabled={field.disabled}
          onChange={field.onChange}
        />
      )}
    </Field>
  );
}

/** Cor do embed: guardada como inteiro RGB, editada como hex (§9). */
export function ColorField(props: FieldProps): React.ReactElement {
  return (
    <Field {...props}>
      {(field) => {
        const hex = colorToHex(Number(field.value ?? 0));
        return (
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="size-11 shrink-0 border-2 border-base-300"
              style={{ backgroundColor: hex }}
            />
            <Input
              value={hex}
              disabled={field.disabled}
              onChange={(event) => {
                const parsed = hexToColor(event.target.value);
                // Hex incompleto não zera o campo: só ignora até fechar 6 dígitos.
                if (parsed !== null) field.onChange(parsed);
              }}
            />
          </div>
        );
      }}
    </Field>
  );
}

export function TemplateField({
  embedColor,
  variables,
  previewModes,
  ...props
}: FieldProps & {
  embedColor: number;
  variables?: readonly TemplateVariable[];
  previewModes?: TemplatePreviewMode[];
}): React.ReactElement {
  return (
    <Field {...props}>
      {(field) => (
        <TemplateEditor
          value={(field.value as MessageTemplate | null) ?? null}
          embedColor={embedColor}
          variables={variables}
          previewModes={previewModes}
          disabled={field.disabled}
          onChange={field.onChange}
        />
      )}
    </Field>
  );
}

/** Atalho para páginas que precisam ler um campo (preview, botão de teste). */
export function useConfigValue<T>(name: string): T {
  return useFormContext().watch(name) as T;
}
