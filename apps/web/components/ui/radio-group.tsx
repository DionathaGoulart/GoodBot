'use client';

import * as React from 'react';
import { cn } from 'cn';
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';

function RadioGroup({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      className={cn('grid w-full gap-2', className)}
      {...props}
    />
  );
}

/** §4.3/§6.4 — o radio também é quadrado; marcado = fill accent com `■`. */
function RadioGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        'retro-border peer flex size-5 shrink-0 items-center justify-center bg-base-200 outline-none transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-40 aria-invalid:border-error',
        'data-checked:bg-accent data-checked:text-accent-content',
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator
        data-slot="radio-group-indicator"
        className="grid place-content-center text-[0.5rem] leading-none"
      >
        ■
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  );
}

export { RadioGroup, RadioGroupItem };
