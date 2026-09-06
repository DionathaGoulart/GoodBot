'use client';

import { useFormContext } from 'react-hook-form';

import { FormControl, FormField, FormItem } from '@/components/ui/form';
import { Switch } from '@/components/ui/switch';

/**
 * §6.2 — o cabeçalho de toda tela de módulo: o switch "módulo ativo". Desligar
 * aqui é o que faz o bot ignorar o módulo inteiro, então ele fica separado dos
 * outros campos, acima dos cards.
 */
export function ModuleToggle({
  name = 'enabled',
  description,
}: {
  name?: string;
  description: string;
}) {
  const { watch } = useFormContext();
  const active = Boolean(watch(name));

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-2 border-base-300 bg-base-200 p-4">
      <div className="flex flex-col gap-1">
        <p className="section-label">MÓDULO {active ? 'ATIVO' : 'DESLIGADO'}</p>
        <p className="text-sm opacity-70">{description}</p>
      </div>
      <FormField
        name={name}
        render={({ field }) => (
          <FormItem>
            <FormControl>
              <Switch
                checked={Boolean(field.value)}
                disabled={field.disabled}
                onCheckedChange={field.onChange}
                aria-label="Módulo ativo"
              />
            </FormControl>
          </FormItem>
        )}
      />
    </div>
  );
}
