'use client';

import { CalendarDays } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { DateRange } from 'react-day-picker';

import { cn } from 'cn';

import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { MAX_RANGE_DAYS, RANGE_PRESETS, type RangePreset } from '@/lib/stats-period';

function toDay(date: Date): string {
  // O calendário devolve datas locais do navegador; só o dia interessa, e ele
  // é reinterpretado no fuso da guild no servidor.
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/**
 * Seletor de período do dashboard (PRD §6.1). Tudo vive no `?range=` — assim a
 * URL é o estado, dá para compartilhar e o refresh não perde a escolha.
 */
export function PeriodPicker({ value }: { value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<DateRange | undefined>();

  function apply(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('range', next);
    startTransition(() => router.replace(`${pathname}?${params.toString()}`, { scroll: false }));
  }

  const custom = !(RANGE_PRESETS as readonly string[]).includes(value);

  return (
    <div className="flex flex-wrap items-center gap-2" aria-busy={pending || undefined}>
      {RANGE_PRESETS.map((preset: RangePreset) => (
        <button
          key={preset}
          type="button"
          aria-pressed={value === preset}
          onClick={() => apply(preset)}
          className={cn('icon-btn', value === preset && 'bg-accent text-accent-content')}
        >
          {preset.toUpperCase()}
        </button>
      ))}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-pressed={custom}
            className={cn('icon-btn', custom && 'bg-accent text-accent-content')}
          >
            <CalendarDays className="size-3" aria-hidden />
            {custom ? value.replace(',', ' — ') : 'PERÍODO'}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-auto p-0">
          <Calendar
            mode="range"
            numberOfMonths={1}
            selected={range}
            onSelect={setRange}
            disabled={{ after: new Date() }}
          />
          <div className="flex items-center justify-between gap-3 border-t-2 border-base-300 p-3">
            <span className="screen-meta">MÁX. {MAX_RANGE_DAYS} DIAS</span>
            <button
              type="button"
              className="icon-btn"
              disabled={!range?.from || !range.to}
              onClick={() => {
                if (!range?.from || !range.to) return;
                setOpen(false);
                apply(`${toDay(range.from)},${toDay(range.to)}`);
              }}
            >
              APLICAR
            </button>
          </div>
        </PopoverContent>
      </Popover>

      {/* §4.5 — o caret conta o carregamento sem apagar os botões. */}
      {pending ? <span className="screen-meta terminal-cursor">ATUALIZANDO</span> : null}
    </div>
  );
}
