'use client';

import * as React from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  MAX_SQUAD_FIELD_OPTIONS,
  MAX_SQUAD_GAME_FIELDS,
  MAX_SQUAD_SIZE,
  MIN_SQUAD_SIZE,
  SQUAD_FIELD_MATCH,
  SQUAD_FIELD_TYPES,
  SquadGameInputSchema,
  type SquadFieldType,
  type SquadGameField,
  type SquadGameInput,
} from '@goodbot/shared';
import { useFieldArray, useForm, useFormContext, useWatch } from 'react-hook-form';
import { toast } from 'sonner';

import { saveSquadGameAction } from '@/app/actions/squads';
import { NumberField, SelectField, SwitchField, TextField } from '@/components/config/fields';
import { EmptyState } from '@/components/retro/states';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import {
  parseOptionLines,
  SQUAD_FIELD_MATCH_LABEL,
  SQUAD_FIELD_TYPE_LABEL,
  withFieldKeys,
} from '@/lib/squad-labels';
import { useGuildId } from '@/lib/use-guild-id';

export const EMPTY_GAME: SquadGameInput = {
  name: '',
  squadSize: 4,
  enabled: true,
  fields: [],
};

const EMPTY_FIELD: SquadGameField = {
  key: '',
  label: '',
  type: 'select',
  options: [],
  required: false,
  match: 'soft',
};

export interface GameEditing {
  game: SquadGameInput;
  /** `null` = criando. */
  id: string | null;
}

/**
 * A primeira mensagem de erro de um campo de lista. O erro de "opção
 * repetida" mora no índice da opção (`options.2`), e o `FormMessage` só lê o
 * erro do campo inteiro.
 */
function firstMessage(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const { message } = error as { message?: unknown };
  if (typeof message === 'string' && message !== '') return message;
  if (Array.isArray(error)) {
    for (const item of error) {
      const nested = firstMessage(item);
      if (nested) return nested;
    }
  }
  return null;
}

/**
 * Opções como texto, uma por linha. O texto mora num estado local porque a
 * lista não guarda a linha em branco que a pessoa acabou de abrir. Ele nasce
 * do valor e não volta a ler dele: um `reset` recria o cartão (o id do
 * `useFieldArray` muda), e trocar para texto livre esconde este campo.
 */
function OptionsInput({
  value,
  onChange,
  ...props
}: Omit<React.ComponentProps<typeof Textarea>, 'value' | 'onChange'> & {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [text, setText] = React.useState(() => value.join('\n'));
  return (
    <Textarea
      {...props}
      rows={4}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        onChange(parseOptionLines(event.target.value));
      }}
    />
  );
}

function FieldCard({ index, onRemove }: { index: number; onRemove: () => void }) {
  const { control, formState, setValue } = useFormContext<SquadGameInput>();
  const type = useWatch({ control, name: `fields.${index}.type` });
  const choice = type !== 'text';

  return (
    <div className="flex flex-col gap-4 border-2 border-base-300 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          name={`fields.${index}.label`}
          label="Pergunta"
          description="Aparece no modal do Discord."
          required
        />
        <TextField
          name={`fields.${index}.key`}
          label="Chave"
          description="Em branco, sai da pergunta. Trocar depois apaga essa resposta dos perfis."
          placeholder="plataforma"
        />
        <FormField
          control={control}
          name={`fields.${index}.type`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Tipo<span className="text-accent-text"> *</span>
              </FormLabel>
              <Select
                value={field.value}
                disabled={field.disabled}
                onValueChange={(next) => {
                  field.onChange(next as SquadFieldType);
                  // Texto livre não tem opções nem entra no match, e o schema
                  // recusa os dois. Com os campos escondidos, não sobraria onde
                  // apagá-los.
                  if (next === 'text') {
                    setValue(`fields.${index}.options`, []);
                    setValue(`fields.${index}.match`, 'none');
                  }
                }}
              >
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {SQUAD_FIELD_TYPES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {SQUAD_FIELD_TYPE_LABEL[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        {choice ? (
          <SelectField
            name={`fields.${index}.match`}
            label="No match"
            description="Precisa bater: só junta quem respondeu igual. Pesa: soma pontos, sem barrar ninguém."
            options={SQUAD_FIELD_MATCH.map((value) => ({
              value,
              label: SQUAD_FIELD_MATCH_LABEL[value],
            }))}
          />
        ) : null}
      </div>

      {choice ? (
        <FormField
          control={control}
          name={`fields.${index}.options`}
          render={({ field, fieldState }) => {
            const error = firstMessage(fieldState.error);
            return (
              <FormItem>
                <FormLabel>
                  Opções<span className="text-accent-text"> *</span>
                </FormLabel>
                <FormDescription>
                  Uma por linha, até {MAX_SQUAD_FIELD_OPTIONS}. Viram a lista de escolha no
                  Discord.
                </FormDescription>
                <FormControl>
                  <OptionsInput
                    name={field.name}
                    ref={field.ref}
                    value={field.value}
                    disabled={field.disabled}
                    onBlur={field.onBlur}
                    onChange={field.onChange}
                  />
                </FormControl>
                {error ? (
                  <p className="text-[10px] uppercase tracking-[0.2em] text-error-text">
                    {'! '}
                    {error}
                  </p>
                ) : null}
              </FormItem>
            );
          }}
        />
      ) : null}

      <SwitchField
        name={`fields.${index}.required`}
        label="Obrigatório"
        description="O modal não fecha sem resposta."
      />
      <button
        type="button"
        className="icon-btn self-start"
        disabled={formState.disabled}
        onClick={onRemove}
      >
        REMOVER PERGUNTA
      </button>
    </div>
  );
}

/** As perguntas do perfil; a ordem aqui é a ordem dos campos no modal. */
function FieldsEditor() {
  const { control, formState } = useFormContext<SquadGameInput>();
  const { fields, append, remove } = useFieldArray({ control, name: 'fields' });
  const full = fields.length >= MAX_SQUAD_GAME_FIELDS;
  const add = () => append({ ...EMPTY_FIELD });

  if (fields.length === 0) {
    return (
      <EmptyState
        description="Sem perguntas, o perfil é só a grade de horários. Cada pergunta vira um campo do modal no Discord."
        action={
          <button
            type="button"
            className="btn-goodchat-outline"
            disabled={formState.disabled}
            onClick={add}
          >
            ADICIONAR PERGUNTA
          </button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {fields.map((field, index) => (
        <FieldCard key={field.id} index={index} onRemove={() => remove(index)} />
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn-goodchat-outline"
          disabled={formState.disabled || full}
          onClick={add}
        >
          ADICIONAR PERGUNTA
        </button>
        <span className="screen-meta">
          {fields.length}/{MAX_SQUAD_GAME_FIELDS} PERGUNTAS
          {full ? ' · LIMITE DO MODAL DO DISCORD' : ''}
        </span>
      </div>
    </div>
  );
}

export function GameSheet({
  editing,
  searchPublished,
  readOnly,
  onClose,
}: {
  editing: GameEditing | null;
  /** Com a mensagem fixa no ar, o toast lembra de atualizá-la. */
  searchPublished: boolean;
  readOnly: boolean;
  onClose: (changed: boolean) => void;
}) {
  const guildId = useGuildId();
  const form = useForm<SquadGameInput>({
    // `as never`: o schema tem defaults, então a entrada do resolver é mais
    // frouxa que a saída e o RHF não reconcilia os dois genéricos sozinho.
    resolver: zodResolver(SquadGameInputSchema as never),
    defaultValues: editing?.game ?? EMPTY_GAME,
    disabled: readOnly,
  });
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (editing) form.reset(editing.game);
  }, [editing, form]);

  const save = form.handleSubmit(async (values) => {
    setSaving(true);
    try {
      const formData = new FormData();
      formData.set('game', JSON.stringify(values));
      if (editing?.id) formData.set('gameId', editing.id);
      const result = await saveSquadGameAction(guildId, formData);
      if (!result.ok) {
        for (const [path, message] of Object.entries(result.fieldErrors ?? {})) {
          form.setError(path as never, { message });
        }
        toast.error('ERRO', { description: result.message });
        return;
      }
      toast.success('SALVO', {
        description: searchPublished
          ? `O jogo ${values.name} foi salvo. Atualize a mensagem de busca para ela mostrar a mudança.`
          : `O jogo ${values.name} foi salvo.`,
      });
      onClose(true);
    } finally {
      setSaving(false);
    }
  });

  // Chave em branco ganha a da pergunta antes da validação: quem cadastra
  // pensa em "Plataforma", não em `plataforma`.
  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    const fields = form.getValues('fields');
    withFieldKeys(fields).forEach((field, index) => {
      if (field.key !== fields[index]?.key) form.setValue(`fields.${index}.key`, field.key);
    });
    return save(event);
  };

  return (
    <Sheet open={editing !== null} onOpenChange={(open) => !open && onClose(false)}>
      <SheetContent className="w-full sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>{editing?.id ? 'EDITAR JOGO' : 'NOVO JOGO'}</SheetTitle>
          <SheetDescription>
            Cada jogo tem o próprio tamanho de squad e as perguntas do perfil, que pesam no match.
          </SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
            {/* Só os campos rolam. Com o rodapé dentro da área rolável o SALVAR
                sai da tela e só volta no fim do formulário, pior no mobile. */}
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4">
              <fieldset disabled={readOnly} className="flex flex-col gap-4">
                <TextField name="name" label="Nome" required />
                <NumberField
                  name="squadSize"
                  label="Jogadores por squad"
                  description="Quando o squad enche, a vaga some da busca."
                  min={MIN_SQUAD_SIZE}
                  max={MAX_SQUAD_SIZE}
                  suffix="JOGADORES"
                />
                <SwitchField
                  name="enabled"
                  label="Ligado"
                  description="Desligado, o jogo sai da mensagem de busca e do match."
                />
                <p className="screen-kicker sigil">PERGUNTAS DO PERFIL</p>
                <FieldsEditor />
              </fieldset>
            </div>

            {readOnly ? (
              <p className="screen-meta px-4">MODO LEITURA · SÓ ADMIN PODE SALVAR</p>
            ) : (
              <SheetFooter className="border-t-2 border-base-300">
                <button type="submit" className="btn-goodchat" disabled={saving}>
                  {saving ? 'SALVANDO_' : 'SALVAR'}
                </button>
              </SheetFooter>
            )}
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
