'use client';

import * as React from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  DANGEROUS_PERMISSIONS,
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
  RoleWriteInputSchema,
  type PermissionName,
} from '@cobot/shared';
import { useForm, useFormContext } from 'react-hook-form';
import { toast } from 'sonner';

import { saveRoleAction } from '@/app/actions/guild';
import { ColorField, SwitchField, TextField } from '@/components/config/fields';
import { Checkbox } from '@/components/ui/checkbox';
import { Form } from '@/components/ui/form';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

import type { z } from 'zod';

/** O formulário não manda `actorId`: quem clicou vem da sessão, no servidor. */
const RoleFormSchema = RoleWriteInputSchema.omit({ actorId: true, reason: true });
type RoleFormValues = z.infer<typeof RoleFormSchema>;

export const EMPTY_ROLE: RoleFormValues = {
  name: '',
  color: 0,
  hoist: false,
  mentionable: false,
  permissions: [],
};

const DANGEROUS = new Set<PermissionName>(DANGEROUS_PERMISSIONS);

/** A checklist agrupada do §6.4; permissão perigosa sai marcada em `error`. */
function PermissionsField() {
  const { watch, setValue, formState } = useFormContext<RoleFormValues>();
  const selected = watch('permissions');
  const disabled = formState.disabled;

  const toggle = (name: PermissionName) => {
    const next = selected.includes(name)
      ? selected.filter((item) => item !== name)
      : [...selected, name];
    setValue('permissions', next, { shouldDirty: true });
  };

  return (
    <div className="flex flex-col gap-4">
      {PERMISSION_GROUPS.map((group) => (
        <fieldset key={group.label} className="flex flex-col gap-2 border-2 border-base-300 p-3">
          <legend className="screen-kicker px-1">{group.label}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {group.permissions.map((name) => (
              <label key={name} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={selected.includes(name)}
                  disabled={disabled}
                  onCheckedChange={() => toggle(name)}
                />
                <span className={DANGEROUS.has(name) ? 'text-error-text' : undefined}>
                  {PERMISSION_LABELS[name]}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

export interface RoleEditing {
  role: RoleFormValues;
  /** `null` = criando. */
  id: string | null;
}

/**
 * Editor de cargo. As permissões que o painel não mostra continuam no cargo: o
 * bot faz o merge com o bitfield atual antes de salvar.
 */
export function RoleSheet({
  editing,
  readOnly,
  onClose,
}: {
  editing: RoleEditing | null;
  readOnly: boolean;
  onClose: (changed: boolean) => void;
}) {
  const form = useForm<RoleFormValues>({
    // `as never`: o schema tem defaults, então a entrada do resolver é mais
    // frouxa que a saída e o RHF não reconcilia os dois genéricos sozinho.
    resolver: zodResolver(RoleFormSchema as never),
    defaultValues: editing?.role ?? EMPTY_ROLE,
    disabled: readOnly,
  });
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (editing) form.reset(editing.role);
  }, [editing, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    setSaving(true);
    try {
      const formData = new FormData();
      formData.set('role', JSON.stringify(values));
      if (editing?.id) formData.set('roleId', editing.id);
      const result = await saveRoleAction(formData);
      if (!result.ok) {
        for (const [path, message] of Object.entries(result.fieldErrors ?? {})) {
          form.setError(path as never, { message });
        }
        toast.error('ERRO', { description: result.message });
        return;
      }
      toast.success('SALVO', { description: result.message });
      onClose(true);
    } finally {
      setSaving(false);
    }
  });

  return (
    <Sheet open={editing !== null} onOpenChange={(open) => !open && onClose(false)}>
      <SheetContent className="w-full sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{editing?.id ? 'EDITAR CARGO' : 'NOVO CARGO'}</SheetTitle>
          <SheetDescription>
            Você não pode conceder uma permissão que você mesmo não tem.
          </SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form
            onSubmit={onSubmit}
            className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4"
          >
            <fieldset disabled={readOnly} className="flex flex-col gap-4">
              <TextField name="name" label="Nome" required />
              <ColorField name="color" label="Cor" description="Preto = sem cor." />
              <SwitchField
                name="hoist"
                label="Separar na lista"
                description="Mostra os membros deste cargo num grupo próprio."
              />
              <SwitchField
                name="mentionable"
                label="Mencionável"
                description="Deixa qualquer um mencionar o cargo."
              />
              <PermissionsField />
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
