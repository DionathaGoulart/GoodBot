'use client';

import * as React from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { TicketTypeInputSchema, type TicketTypeInput } from '@cobot/shared';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { saveTicketTypeAction } from '@/app/actions/modules';
import { CHANNEL_TYPES } from '@/components/config/discord-options';
import {
  DiscordField,
  NumberField,
  TemplateField,
  TextField,
} from '@/components/config/fields';
import { Form } from '@/components/ui/form';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

export const EMPTY_TYPE: TicketTypeInput = {
  name: '',
  categoryId: '',
  supportRoleIds: [],
  openingMessage: null,
  maxOpenPerUser: null,
  namingPattern: null,
};

export interface TypeEditing {
  type: TicketTypeInput;
  /** `null` = criando. */
  id: string | null;
}

export function TypeSheet({
  editing,
  embedColor,
  readOnly,
  onClose,
}: {
  editing: TypeEditing | null;
  embedColor: number;
  readOnly: boolean;
  onClose: (changed: boolean) => void;
}) {
  const form = useForm<TicketTypeInput>({
    // `as never`: o schema tem defaults, então a entrada do resolver é mais
    // frouxa que a saída e o RHF não reconcilia os dois genéricos sozinho.
    resolver: zodResolver(TicketTypeInputSchema as never),
    defaultValues: editing?.type ?? EMPTY_TYPE,
    disabled: readOnly,
  });
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (editing) form.reset(editing.type);
  }, [editing, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    setSaving(true);
    try {
      const formData = new FormData();
      formData.set('type', JSON.stringify(values));
      if (editing?.id) formData.set('typeId', editing.id);
      const result = await saveTicketTypeAction(formData);
      if (!result.ok) {
        for (const [path, message] of Object.entries(result.fieldErrors ?? {})) {
          form.setError(path as never, { message });
        }
        toast.error('ERRO', { description: result.message });
        return;
      }
      toast.success('SALVO', { description: `O tipo ${values.name} está no ar.` });
      onClose(true);
    } finally {
      setSaving(false);
    }
  });

  return (
    <Sheet open={editing !== null} onOpenChange={(open) => !open && onClose(false)}>
      <SheetContent className="w-full sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{editing?.id ? 'EDITAR TIPO' : 'NOVO TIPO'}</SheetTitle>
          <SheetDescription>
            Cada tipo é uma opção no painel de abertura, com categoria e equipe próprias.
          </SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form
            onSubmit={onSubmit}
            className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4"
          >
            <fieldset disabled={readOnly} className="flex flex-col gap-4">
              <TextField name="name" label="Nome" required />
              <DiscordField
                name="categoryId"
                kind="channel"
                channelTypes={[CHANNEL_TYPES.category]}
                label="Categoria"
                description="Onde o canal do ticket é criado."
                required
              />
              <DiscordField
                name="supportRoleIds"
                kind="role"
                multiple
                label="Cargos de suporte"
                description="Quem enxerga e atende os tickets deste tipo."
              />
              <TemplateField
                name="openingMessage"
                label="Mensagem de abertura"
                embedColor={embedColor}
              />
              <NumberField
                name="maxOpenPerUser"
                label="Tickets abertos por membro"
                description="Vazio herda o limite do módulo."
                min={1}
                max={20}
              />
              <TextField
                name="namingPattern"
                label="Padrão de nome"
                description="Vazio herda o padrão do módulo. Aceita {number}, {user} e {type}."
              />
            </fieldset>

            {readOnly ? (
              <p className="screen-meta">MODO LEITURA · SÓ ADMIN PODE SALVAR</p>
            ) : (
              <SheetFooter className="px-0">
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
