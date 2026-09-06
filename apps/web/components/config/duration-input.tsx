'use client';

import * as React from 'react';
import { DAY_MS, HOUR_MS, MINUTE_MS, WEEK_MS } from '@cobot/shared';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const UNITS = [
  { key: 'm', label: 'MIN', ms: MINUTE_MS },
  { key: 'h', label: 'H', ms: HOUR_MS },
  { key: 'd', label: 'D', ms: DAY_MS },
  { key: 'w', label: 'SEM', ms: WEEK_MS },
] as const;

type UnitKey = (typeof UNITS)[number]['key'];

const PRESETS = [
  { label: '10M', ms: 10 * MINUTE_MS },
  { label: '1H', ms: HOUR_MS },
  { label: '7D', ms: 7 * DAY_MS },
];

/** A maior unidade que divide `ms` sem sobra — 3600000 aparece como `1 H`, não `60 MIN`. */
export function splitDuration(ms: number): { amount: number; unit: UnitKey } {
  for (const unit of [...UNITS].reverse()) {
    if (ms >= unit.ms && ms % unit.ms === 0) return { amount: ms / unit.ms, unit: unit.key };
  }
  return { amount: Math.max(1, Math.round(ms / MINUTE_MS)), unit: 'm' };
}

export function toMs(amount: number, unit: UnitKey): number {
  return amount * (UNITS.find((u) => u.key === unit)?.ms ?? MINUTE_MS);
}

/**
 * §6.4 — duração numa moldura só: número + unidade, com atalhos como `tag`s.
 * O valor que sai é sempre em ms, que é o que os schemas de `@cobot/shared`
 * esperam.
 */
export function DurationInput({
  value,
  onChange,
  disabled,
  id,
  max,
}: {
  value: number;
  onChange: (ms: number) => void;
  disabled?: boolean;
  id?: string;
  max?: number;
}) {
  // O split vem do valor, mas a unidade escolhida à mão precisa sobreviver a
  // um `amount` que passe a dividir melhor em outra unidade.
  const [unit, setUnit] = React.useState<UnitKey>(() => splitDuration(value).unit);
  const amount = Math.max(1, Math.round(value / toMs(1, unit)));

  function emit(nextAmount: number, nextUnit: UnitKey) {
    const ms = toMs(Math.max(1, nextAmount), nextUnit);
    onChange(max !== undefined ? Math.min(ms, max) : ms);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex border-2 border-base-300 bg-base-200">
        <Input
          id={id}
          type="number"
          min={1}
          value={Number.isFinite(amount) ? amount : 1}
          disabled={disabled}
          onChange={(event) => emit(Number(event.target.value), unit)}
          className="border-0 shadow-none"
        />
        <Select
          value={unit}
          disabled={disabled}
          onValueChange={(next) => {
            setUnit(next as UnitKey);
            emit(amount, next as UnitKey);
          }}
        >
          <SelectTrigger className="w-28 border-0 border-l-2 border-base-300 shadow-none">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {UNITS.map((option) => (
              <SelectItem key={option.key} value={option.key}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex gap-1.5">
        {PRESETS.filter((preset) => max === undefined || preset.ms <= max).map((preset) => (
          <button
            key={preset.label}
            type="button"
            disabled={disabled}
            className="tag tag-muted disabled:opacity-40"
            onClick={() => {
              setUnit(splitDuration(preset.ms).unit);
              onChange(preset.ms);
            }}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}
