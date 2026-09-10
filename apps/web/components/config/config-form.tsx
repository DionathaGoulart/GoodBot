'use client';

import * as React from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, type DefaultValues, type FieldValues, type Path } from 'react-hook-form';
import { toast } from 'sonner';

import { saveConfigPageAction } from '@/app/actions/config';
import { useAutoRefreshPause } from '@/components/layout/auto-refresh';
import { Form } from '@/components/ui/form';
import { useGuildId } from '@/lib/use-guild-id';
import { CONFIG_PAGES, type ConfigPage } from '@/lib/config-pages';

/**
 * §6.4 — a casca de toda página de configuração: react-hook-form com o
 * resolver do schema de `@goodbot/shared`, rodapé sticky que só aparece quando o
 * formulário está sujo e toast no fim (§6.8).
 *
 * O `readOnly` é o modo `mod` (PRD §9.2): campos desabilitados e nenhum
 * rodapé. Isso é conforto de UI — quem barra de verdade é a server action, que
 * exige `admin`.
 */
export function ConfigForm<Values extends FieldValues>({
  page,
  defaultValues,
  readOnly = false,
  children,
}: {
  page: ConfigPage;
  defaultValues: Values;
  readOnly?: boolean;
  children: React.ReactNode;
}) {
  const guildId = useGuildId();
  const form = useForm<Values>({
    // O schema é o mesmo do servidor; a página só diz qual é.
    resolver: zodResolver(CONFIG_PAGES[page].schema as never),
    defaultValues: defaultValues as DefaultValues<Values>,
    disabled: readOnly,
  });
  const [saving, setSaving] = React.useState(false);

  // Enquanto houver alteração não salva, o painel para de se atualizar sozinho
  // (Etapa 22): um refresh remontaria o formulário e apagaria o que foi digitado.
  useAutoRefreshPause(form.formState.isDirty);

  const onSubmit = form.handleSubmit(async (values) => {
    setSaving(true);
    try {
      const formData = new FormData();
      formData.set('config', JSON.stringify(values));
      const result = await saveConfigPageAction(guildId, page, formData);

      if (!result.ok) {
        for (const [path, message] of Object.entries(result.fieldErrors ?? {})) {
          form.setError(path as Path<Values>, { message });
        }
        toast.error('ERRO', { description: result.message ?? 'Não foi possível salvar.' });
        return;
      }

      // `reset` com os valores salvos: o formulário volta a ficar limpo sem
      // esperar o servidor devolver a página revalidada.
      form.reset(values);
      toast.success('SALVO', { description: result.message ?? 'Configuração aplicada.' });
    } catch {
      toast.error('ERRO', { description: 'Não foi possível falar com o servidor.' });
    } finally {
      setSaving(false);
    }
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="flex flex-col gap-6">
        <fieldset disabled={readOnly} className="flex min-w-0 flex-col gap-6">
          {children}
        </fieldset>

        {readOnly ? (
          <p className="screen-meta">MODO LEITURA · SÓ ADMIN PODE SALVAR</p>
        ) : form.formState.isDirty ? (
          <div className="sticky bottom-0 -mx-4 flex items-center justify-between gap-4 border-t-2 border-base-300 bg-base-100 px-4 py-3 sm:-mx-6 sm:px-6">
            <button
              type="button"
              className="btn-goodchat-outline"
              disabled={saving}
              onClick={() => form.reset()}
            >
              DESCARTAR
            </button>
            <button type="submit" className="btn-goodchat" disabled={saving}>
              {saving ? 'SALVANDO_' : 'SALVAR'}
            </button>
          </div>
        ) : null}
      </form>
    </Form>
  );
}
