'use client';

import * as React from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { TicketPanelInputSchema, type TicketPanelInput } from '@cobot/shared';
import { useFormContext, useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { saveTicketPanelAction } from '@/app/actions/modules';
import { DiscordField, TemplateField } from '@/components/config/fields';
import { EmptyState } from '@/components/retro/states';
import { Checkbox } from '@/components/ui/checkbox';
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

import type { TicketTypeRow } from '@/lib/tickets';

export const EMPTY_TICKET_PANEL: TicketPanelInput = {
  channelId: '',
  content: { content: 'Precisa de ajuda? Abra um ticket:' },
  typeIds: [],
};

/** Os tipos oferecidos no painel: uma caixa por tipo cadastrado. */
function TypesField({ types }: { types: TicketTypeRow[] }) {
  const { formState } = useFormContext<TicketPanelInput>();

  if (types.length === 0) {
    return (
      <EmptyState description="Cadastre um tipo na aba TIPOS antes de montar o painel." />
    );
  }

  return (
    <FormField
      name="typeIds"
      render={({ field }) => {
        const selected = (field.value as string[] | undefined) ?? [];
        return (
          <FormItem>
            <p className="section-label">
              TIPOS OFERECIDOS<span className="text-accent-text"> *</span>
            </p>
            <FormControl>
              <div className="flex flex-col gap-2">
                {types.map((type) => (
                  <label key={type.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={selected.includes(type.id)}
                      disabled={formState.disabled}
                      onCheckedChange={(checked) =>
                        field.onChange(
                          checked
                            ? [...selected, type.id]
                            : selected.filter((id) => id !== type.id),
                        )
                      }
                    />
                    {type.name}
                  </label>
                ))}
              </div>
            </FormControl>
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
}

export interface TicketPanelEditing {
  panel: TicketPanelInput;
  /** `null` = criando. */
  id: string | null;
}

export function TicketPanelSheet({
  editing,
  types,
  embedColor,
  readOnly,
  onClose,
}: {
  editing: TicketPanelEditing | null;
  types: TicketTypeRow[];
  embedColor: number;
  readOnly: boolean;
  onClose: (changed: boolean) => void;
}) {
  const form = useForm<TicketPanelInput>({
    // `as never`: o schema tem defaults, então a entrada do resolver é mais
    // frouxa que a saída e o RHF não reconcilia os dois genéricos sozinho.
    resolver: zodResolver(TicketPanelInputSchema as never),
    defaultValues: editing?.panel ?? EMPTY_TICKET_PANEL,
    disabled: readOnly,
  });
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (editing) form.reset(editing.panel);
  }, [editing, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    setSaving(true);
    try {
      const formData = new FormData();
      formData.set('panel', JSON.stringify(values));
      if (editing?.id) formData.set('panelId', editing.id);
      const result = await saveTicketPanelAction(formData);
      if (!result.ok) {
        for (const [path, message] of Object.entries(result.fieldErrors ?? {})) {
          form.setError(path as never, { message });
        }
        toast.error('ERRO', { description: result.message });
        return;
      }
      toast.success('SALVO', {
        description: 'Publique o painel para a mensagem sair no Discord.',
      });
      onClose(true);
    } finally {
      setSaving(false);
    }
  });

  return (
    <Sheet open={editing !== null} onOpenChange={(open) => !open && onClose(false)}>
      <SheetContent className="w-full sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{editing?.id ? 'EDITAR PAINEL' : 'NOVO PAINEL'}</SheetTitle>
          <SheetDescription>
            A mensagem com os botões que abrem ticket. Salvar não republica.
          </SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form
            onSubmit={onSubmit}
            className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4"
          >
            <fieldset disabled={readOnly} className="flex flex-col gap-4">
              <DiscordField name="channelId" kind="channel" label="Canal" required />
              <TemplateField name="content" label="Mensagem" embedColor={embedColor} required />
              <TypesField types={types} />
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
