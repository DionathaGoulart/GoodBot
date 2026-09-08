'use client';

import * as React from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  MAX_PANEL_ITEMS,
  REACTION_ROLE_MODES,
  REACTION_ROLE_STYLES,
  ReactionRolePanelInputSchema,
  type ReactionRoleMode,
  type ReactionRolePanelInput,
  type ReactionRoleStyle,
} from '@cobot/shared';
import { useFieldArray, useForm, useFormContext } from 'react-hook-form';
import { toast } from 'sonner';

import { savePanelAction } from '@/app/actions/modules';
import { DiscordField, SelectField, TemplateField, TextField } from '@/components/config/fields';
import { EmptyState } from '@/components/retro/states';
import { Form } from '@/components/ui/form';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

const MODE_LABEL: Record<ReactionRoleMode, string> = {
  single: 'UM CARGO SÓ',
  multiple: 'VÁRIOS CARGOS',
  toggle: 'LIGA E DESLIGA',
};

const STYLE_LABEL: Record<ReactionRoleStyle, string> = {
  buttons: 'BOTÕES',
  select: 'MENU SUSPENSO',
  reactions: 'REAÇÕES',
};

export const EMPTY_PANEL: ReactionRolePanelInput = {
  channelId: '',
  mode: 'toggle',
  style: 'buttons',
  content: { content: 'Escolha seus cargos:' },
  items: [],
};

/** A lista de cargos do painel; a ordem aqui é a ordem dos botões no Discord. */
function ItemsField({ style }: { style: ReactionRoleStyle }) {
  const { control, formState } = useFormContext<ReactionRolePanelInput>();
  const { fields, append, remove } = useFieldArray({ control, name: 'items' });
  const disabled = formState.disabled;

  const add = () => append({ roleId: '', emoji: null, label: '', description: null });

  if (fields.length === 0) {
    return (
      <EmptyState
        description="Nenhum cargo no painel. Cada item vira um botão (ou uma opção) na mensagem."
        action={
          <button type="button" className="btn-goodchat-outline" disabled={disabled} onClick={add}>
            ADICIONAR CARGO
          </button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {fields.map((field, index) => (
        <div key={field.id} className="grid gap-3 border-2 border-base-300 p-3 sm:grid-cols-2">
          <DiscordField name={`items.${index}.roleId`} kind="role" label="Cargo" required />
          <TextField
            name={`items.${index}.label`}
            label="Texto"
            description="O que aparece no botão ou na opção."
            required
          />
          <TextField
            name={`items.${index}.emoji`}
            label="Emoji"
            description={
              style === 'reactions'
                ? 'Obrigatório neste estilo: é o emoji que o membro reage.'
                : 'Unicode (🎮) ou nome:id de emoji do servidor. Opcional.'
            }
            placeholder="🎮"
            required={style === 'reactions'}
          />
          {style === 'select' ? (
            <TextField name={`items.${index}.description`} label="Descrição da opção" />
          ) : (
            <div />
          )}
          <div className="sm:col-span-2">
            <button
              type="button"
              className="icon-btn"
              disabled={disabled}
              onClick={() => remove(index)}
            >
              REMOVER CARGO
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        className="btn-goodchat-outline self-start"
        disabled={disabled || fields.length >= MAX_PANEL_ITEMS}
        onClick={add}
      >
        ADICIONAR CARGO
      </button>
    </div>
  );
}

export interface PanelEditing {
  panel: ReactionRolePanelInput;
  /** `null` = criando. */
  id: string | null;
}

/**
 * Editor de painel. Salvar grava no banco e **não** republica: quem já tem a
 * mensagem no ar escolhe quando atualizá-la, no botão da lista.
 */
export function PanelSheet({
  editing,
  embedColor,
  readOnly,
  onClose,
}: {
  editing: PanelEditing | null;
  embedColor: number;
  readOnly: boolean;
  onClose: (changed: boolean) => void;
}) {
  const form = useForm<ReactionRolePanelInput>({
    // `as never`: o schema tem defaults, então a entrada do resolver é mais
    // frouxa que a saída e o RHF não reconcilia os dois genéricos sozinho.
    resolver: zodResolver(ReactionRolePanelInputSchema as never),
    defaultValues: editing?.panel ?? EMPTY_PANEL,
    disabled: readOnly,
  });
  const [saving, setSaving] = React.useState(false);
  const style = form.watch('style');

  React.useEffect(() => {
    if (editing) form.reset(editing.panel);
  }, [editing, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    setSaving(true);
    try {
      const formData = new FormData();
      formData.set('panel', JSON.stringify(values));
      if (editing?.id) formData.set('panelId', editing.id);
      const result = await savePanelAction(formData);
      if (!result.ok) {
        for (const [path, message] of Object.entries(result.fieldErrors ?? {})) {
          form.setError(path as never, { message });
        }
        toast.error('ERRO', { description: result.message });
        return;
      }
      toast.success('SALVO', {
        description: result.message ?? 'Publique o painel para a mensagem sair no Discord.',
      });
      onClose(true);
    } finally {
      setSaving(false);
    }
  });

  return (
    <Sheet open={editing !== null} onOpenChange={(open) => !open && onClose(false)}>
      <SheetContent className="w-full sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>{editing?.id ? 'EDITAR PAINEL' : 'NOVO PAINEL'}</SheetTitle>
          <SheetDescription>
            Salvar guarda o painel; publicar é o que manda (ou atualiza) a mensagem.
          </SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
            {/* Só os campos rolam. Com o rodapé dentro da área rolável o SALVAR
                sai da tela e só volta no fim do formulário — pior no mobile. */}
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4">
              <fieldset disabled={readOnly} className="flex flex-col gap-4">
                <DiscordField name="channelId" kind="channel" label="Canal" required />
                <SelectField
                  name="mode"
                  label="Modo"
                  description="Como os cargos se comportam quando o membro escolhe."
                  options={REACTION_ROLE_MODES.map((value) => ({
                    value,
                    label: MODE_LABEL[value],
                  }))}
                  required
                />
                <SelectField
                  name="style"
                  label="Estilo"
                  options={REACTION_ROLE_STYLES.map((value) => ({
                    value,
                    label: STYLE_LABEL[value],
                  }))}
                  required
                />
                <TemplateField name="content" label="Mensagem" embedColor={embedColor} required />
                <ItemsField style={style} />
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
