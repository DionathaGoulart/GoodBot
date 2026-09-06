'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { DayPicker } from 'react-day-picker';
import { ptBR } from 'react-day-picker/locale';

import { cn } from 'cn';

/**
 * `react-day-picker` vestido com a skin retro (§4, §6.4): quadrado, moldura
 * 2px, seleção em `accent`. Não importamos o `style.css` do pacote de
 * propósito — ele traz raio e cores próprias, e aqui hex/radius só existem em
 * `globals.css`.
 */
export function Calendar({
  className,
  classNames,
  ...props
}: React.ComponentProps<typeof DayPicker>) {
  return (
    <DayPicker
      locale={ptBR}
      showOutsideDays
      className={cn('w-fit p-3 text-sm', className)}
      classNames={{
        months: 'flex flex-col gap-4',
        month: 'flex flex-col gap-3',
        month_caption: 'flex h-8 items-center justify-center',
        caption_label: 'text-[10px] font-black uppercase tracking-[0.2em]',
        nav: 'flex items-center justify-between',
        button_previous: 'icon-btn size-7 p-0',
        button_next: 'icon-btn size-7 p-0',
        month_grid: 'w-full border-collapse',
        weekdays: 'flex',
        weekday: 'screen-meta w-8 text-center',
        week: 'flex w-full',
        day: 'size-8 p-0 text-center',
        day_button: 'size-8 border-2 border-transparent text-xs tabular-nums hover:border-base-300',
        selected: 'bg-accent text-accent-content',
        range_middle: 'bg-accent/30 text-base-content',
        today: 'border-2 border-base-300',
        outside: 'opacity-30',
        disabled: 'opacity-30',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, ...rest }) =>
          orientation === 'left' ? (
            <ChevronLeft className="size-4" {...rest} />
          ) : (
            <ChevronRight className="size-4" {...rest} />
          ),
      }}
      {...props}
    />
  );
}
