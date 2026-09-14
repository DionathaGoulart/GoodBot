'use client';

import * as React from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  answersSchemaFor,
  SquadAdminReasonSchema,
  type SquadAnswers,
  type SquadGameField,
} from '@goodbot/shared';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { editPlayerAnswersAction } from '@/app/actions/squads';
import { SelectField, TextAreaField, TextField } from '@/components/config/fields';
import { Checkbox } from '@/components/ui/checkbox';
import { Form, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useGuildId } from '@/lib/use-guild-id';

import { withPayload } from './form-data';

interface AnswersValues {
  answers: Record<string, string | string[]>;
  reason: string;
}

/** O valor inicial de cada campo no formato do input: texto, opção ou lista. */
function initialAnswers(
  fields: readonly SquadGameField[],
  answers: SquadAnswers,
): AnswersValues['answers'] {
  return Object.fromEntries(
    fields.map((field) => {
      const current = Object.hasOwn(answers, field.key) ? answers[field.key] : undefined;
      if (field.type === 'tags') return [field.key, Array.isArray(current) ? current : []];
      return [field.key, typeof current === 'string' ? current : ''];
    }),
  );
}

/** Um grupo de caixas: `tags` guarda a lista das opções marcadas. */
function TagsField({ field }: { field: SquadGameField }) {
  return (
    <FormField
      name={`answers.${field.key}`}
      render={({ field: control }) => {
        const value = Array.isArray(control.value) ? (control.value as string[]) : [];
        return (
          <FormItem>
            <FormLabel>
              {field.label}
              {field.required ? <span className="text-accent-text"> *</span> : null}
            </FormLabel>
            <div className="flex flex-wrap gap-3">
              {field.options.map((option) => (
                <label key={option} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    aria-label={option}
                    checked={value.includes(option)}
                    onCheckedChange={(next) =>
                      control.onChange(
                        next === true
                          ? [...value, option]
                          : value.filter((item) => item !== option),
                      )
                    }
                  />
                  {option}
                </label>
              ))}
            </div>
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
}

/**
 * Editar as respostas de outra pessoa. Conferido contra os campos atuais do
 * jogo antes de sair daqui (o mesmo `answersSchemaFor` do bot) e com o motivo
 * obrigatório, que vai na DM. A grade de horários fica de fora: só a própria
 * pessoa marca.
 */
export function PlayerAnswersForm({
  gameId,
  userId,
  fields,
  answers,
  onCancel,
  onSaved,
}: {
  gameId: string;
  userId: string;
  fields: SquadGameField[];
  answers: SquadAnswers;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const guildId = useGuildId();
  const schema = React.useMemo(
    () => z.object({ answers: answersSchemaFor(fields), reason: SquadAdminReasonSchema }),
    [fields],
  );
  const form = useForm<AnswersValues>({
    resolver: zodResolver(schema as never),
    defaultValues: { answers: initialAnswers(fields, answers), reason: '' },
  });
  const [saving, setSaving] = React.useState(false);

  const onSubmit = form.handleSubmit(async (values) => {
    setSaving(true);
    try {
      const result = await editPlayerAnswersAction(
        guildId,
        withPayload({ gameId, userId, answers: values.answers, reason: values.reason }),
      );
      if (!result.ok) {
        for (const [path, message] of Object.entries(result.fieldErrors ?? {})) {
          form.setError(path as never, { message });
        }
        toast.error('ERRO', { description: result.message });
        return;
      }
      if (result.notified === false) {
        toast.warning('FEITO, SEM DM', { description: result.message });
      } else {
        toast.success('SALVO', { description: result.message });
      }
      onSaved();
    } catch {
      toast.error('ERRO', { description: 'Não foi possível falar com o servidor.' });
    } finally {
      setSaving(false);
    }
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {fields.map((field) => {
          const name = `answers.${field.key}`;
          if (field.type === 'tags') return <TagsField key={field.key} field={field} />;
          if (field.type === 'select') {
            return (
              <SelectField
                key={field.key}
                name={name}
                label={field.label}
                required={field.required}
                options={field.options.map((option) => ({ value: option, label: option }))}
              />
            );
          }
          return (
            <TextField key={field.key} name={name} label={field.label} required={field.required} />
          );
        })}
        <TextAreaField name="reason" label="Motivo (vai na DM da pessoa)" required />
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="btn-goodchat-outline"
            disabled={saving}
            onClick={onCancel}
          >
            CANCELAR
          </button>
          <button type="submit" className="btn-goodchat" disabled={saving}>
            {saving ? 'SALVANDO_' : 'SALVAR'}
          </button>
        </div>
      </form>
    </Form>
  );
}
