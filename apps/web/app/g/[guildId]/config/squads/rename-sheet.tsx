'use client';

import * as React from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { SquadNameSchema } from '@goodbot/shared';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { renameSquadAction } from '@/app/actions/squads';
import { TextField } from '@/components/config/fields';
import { Form } from '@/components/ui/form';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useGuildId } from '@/lib/use-guild-id';

const RenameSchema = z.object({ name: SquadNameSchema });
type RenameValues = z.infer<typeof RenameSchema>;

export interface RenameEditing {
  squadId: string;
  name: string;
}

export function RenameSheet({
  editing,
  onClose,
}: {
  editing: RenameEditing | null;
  onClose: (changed: boolean) => void;
}) {
  const guildId = useGuildId();
  const form = useForm<RenameValues>({
    resolver: zodResolver(RenameSchema as never),
    defaultValues: { name: editing?.name ?? '' },
  });
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (editing) form.reset({ name: editing.name });
  }, [editing, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    if (!editing) return;
    setSaving(true);
    try {
      const formData = new FormData();
      formData.set('squadId', editing.squadId);
      formData.set('name', values.name);
      const result = await renameSquadAction(guildId, formData);
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
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>RENOMEAR SQUAD</SheetTitle>
          <SheetDescription>O nome aparece nos embeds e no canal de texto do squad.</SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4">
              <TextField name="name" label="Nome" required />
            </div>
            <SheetFooter className="border-t-2 border-base-300">
              <button type="submit" className="btn-goodchat" disabled={saving}>
                {saving ? 'SALVANDO_' : 'SALVAR'}
              </button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
