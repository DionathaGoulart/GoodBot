'use client';

import * as React from 'react';

import { Command, CommandEmpty, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export interface MultiSelectOption {
  value: string;
  label: string;
}

/**
 * §6.3 — caixa de marcar várias opções usada pelas barras de filtro (casos,
 * auditoria). Nasceu dentro da tabela de casos e virou componente na Etapa 22,
 * quando a auditoria ganhou o mesmo filtro por origem.
 */
export function MultiSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  /** `string` simples vira rótulo em caixa alta; o par permite outro texto. */
  options: readonly (string | MultiSelectOption)[];
  value: readonly string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const items = options.map((option) =>
    typeof option === 'string' ? { value: option, label: option.toUpperCase() } : option,
  );
  const labelFor = (item: string) =>
    items.find((option) => option.value === item)?.label ?? item.toUpperCase();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        aria-label={label}
        className="flex min-h-11 w-full items-center justify-between gap-2 border-2 border-base-300 bg-base-200 px-3 py-1.5 text-left text-sm"
      >
        <span className="flex flex-wrap items-center gap-1.5">
          {value.length === 0 ? (
            <span className="opacity-60">Todos</span>
          ) : (
            value.map((item) => (
              <span key={item} className="tag tag-muted">
                {labelFor(item)}
              </span>
            ))
          )}
        </span>
        <span aria-hidden className="opacity-60">
          ▼
        </span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
        <Command>
          <CommandList>
            <CommandEmpty>Nada aqui.</CommandEmpty>
            {items.map((option) => (
              <CommandItem
                key={option.value}
                value={option.value}
                onSelect={() =>
                  onChange(
                    value.includes(option.value)
                      ? value.filter((item) => item !== option.value)
                      : [...value, option.value],
                  )
                }
              >
                <span aria-hidden className="w-4">
                  {value.includes(option.value) ? '×' : ''}
                </span>
                {option.label}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
