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
import { TemplateEditor } from './template-editor';

import type { MessageTemplate } from '@cobot/shared';

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
  ...props
}: FieldProps & { embedColor: number }): React.ReactElement {
  return (
    <Field {...props}>
      {(field) => (
        <TemplateEditor
          value={(field.value as MessageTemplate | null) ?? null}
          embedColor={embedColor}
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
