'use client';

import * as React from 'react';
import { cn } from 'cn';
import { Checkbox as CheckboxPrimitive } from 'radix-ui';

/** §6.4 — quadrado de 1.25rem; marcado = fill accent com `✓` literal. */
function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'retro-border peer flex size-5 shrink-0 items-center justify-center bg-base-200 outline-none transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-40 aria-invalid:border-error',
        'data-checked:bg-accent data-checked:text-accent-content',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-[0.75rem] leading-none font-black"
      >
        ✓
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
