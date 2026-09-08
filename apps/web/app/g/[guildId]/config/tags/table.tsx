'use client';

import * as React from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { TagInputSchema, type TagInput } from '@cobot/shared';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { deleteTagAction, saveTagAction } from '@/app/actions/config';
import { TemplateField, TextField } from '@/components/config/fields';
import { Panel } from '@/components/retro/panel';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import type { TagRow } from '@/lib/tags';

const EMPTY_TAG: TagInput = { name: '', content: { content: '' } };

/** §6.8 — confirmação inline: o botão vira `CONFIRMAR?` por 3s e volta. */
function DeleteButton({ name, onDeleted }: { name: string; onDeleted: () => void }) {
  const [armed, setArmed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 3_000);
    return () => clearTimeout(timer);
  }, [armed]);

  return (
    <button
      type="button"
      disabled={busy}
      className={armed ? 'icon-btn border-error text-error-text' : 'icon-btn'}
      onClick={async () => {
        if (!armed) {
          setArmed(true);
          return;
        }
        setBusy(true);
        try {
          const formData = new FormData();
          formData.set('name', name);
          const result = await deleteTagAction(formData);
          if (result.ok) {
            toast.success('APAGADO', { description: `A tag ${name} foi removida.` });
            onDeleted();
          } else {
            toast.error('ERRO', { description: result.message });
          }
        } finally {
          setBusy(false);
          setArmed(false);
        }
      }}
    >
      {armed ? 'CONFIRMAR?' : 'APAGAR'}
    </button>
  );
}

function TagSheet({
  editing,
  embedColor,
  onClose,
}: {
  /** `null` = fechado; uma tag sem `name` = criando. */
  editing: { tag: TagInput; isEdit: boolean } | null;
  embedColor: number;
  onClose: (changed: boolean) => void;
}) {
  const form = useForm<TagInput>({
    // `as never`: o schema tem defaults, então a entrada do resolver é mais
    // frouxa que a saída e o RHF não reconcilia os dois genéricos sozinho.
    resolver: zodResolver(TagInputSchema as never),
    defaultValues: editing?.tag ?? EMPTY_TAG,
  });
  const [saving, setSaving] = React.useState(false);

  // Abrir outra tag reaproveita o mesmo formulário; sem isso ele ficaria com
  // os valores da anterior.
  React.useEffect(() => {
    if (editing) form.reset(editing.tag);
  }, [editing, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    setSaving(true);
    try {
      const formData = new FormData();
      formData.set('tag', JSON.stringify(values));
      formData.set('mode', editing?.isEdit ? 'edit' : 'create');
      const result = await saveTagAction(formData);
      if (!result.ok) {
        for (const [path, message] of Object.entries(result.fieldErrors ?? {})) {
          form.setError(path as keyof TagInput, { message });
        }
        toast.error('ERRO', { description: result.message });
        return;
      }
      toast.success('SALVO', { description: `A tag ${values.name} está no ar.` });
      onClose(true);
    } finally {
      setSaving(false);
    }
  });

  return (
    <Sheet open={editing !== null} onOpenChange={(open) => !open && onClose(false)}>
      <SheetContent className="w-full sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{editing?.isEdit ? 'EDITAR TAG' : 'NOVA TAG'}</SheetTitle>
          <SheetDescription>
            O conteúdo aceita as mesmas variáveis das boas-vindas.
          </SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
            {/* Só os campos rolam. Com o rodapé dentro da área rolável o SALVAR
                sai da tela e só volta no fim do formulário — pior no mobile. */}
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4">
              <fieldset disabled={editing?.isEdit} className="flex flex-col gap-4">
                <TextField
                  name="name"
                  label="Nome"
                  description="É o que vai depois de /tag. Não dá para renomear depois: o contador de usos é da linha."
                  required
                />
              </fieldset>
              <TemplateField name="content" label="Conteúdo" embedColor={embedColor} required />
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

export function TagsTable({
  tags,
  embedColor,
  readOnly,
}: {
  tags: TagRow[];
  embedColor: number;
  readOnly: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<{ tag: TagInput; isEdit: boolean } | null>(null);

  function close(changed: boolean) {
    setEditing(null);
    if (changed) router.refresh();
  }

  return (
    <Panel
      title="TAGS.LST"
      actions={
        readOnly ? null : (
          <button
            type="button"
            className="icon-btn"
            onClick={() => setEditing({ tag: EMPTY_TAG, isEdit: false })}
          >
            NOVA TAG
          </button>
        )
      }
    >
      {tags.length === 0 ? (
        <EmptyState description="Nenhuma tag criada. Tags são respostas prontas chamadas por /tag." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>NOME</TableHead>
              <TableHead>USOS</TableHead>
              <TableHead>ATUALIZADA</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {tags.map((tag) => (
              <TableRow key={tag.name}>
                <TableCell className="font-bold">{tag.name}</TableCell>
                <TableCell className="tabular-nums">{tag.uses}</TableCell>
                <TableCell className="screen-meta">
                  {new Date(tag.updatedAt).toLocaleDateString('pt-BR')}
                </TableCell>
                <TableCell className="flex justify-end gap-2">
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() =>
                      setEditing({ tag: { name: tag.name, content: tag.content }, isEdit: true })
                    }
                  >
                    {readOnly ? 'VER' : 'EDITAR'}
                  </button>
                  {readOnly ? null : (
                    <DeleteButton name={tag.name} onDeleted={() => router.refresh()} />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <TagSheet editing={editing} embedColor={embedColor} onClose={close} />
    </Panel>
  );
}
