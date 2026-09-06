'use client';

import * as React from 'react';
import { cn } from 'cn';
import { Switch as SwitchPrimitive } from 'radix-ui';

/** §6.4 — trilho retangular 2.5rem×1.25rem com thumb quadrado. Nunca pílula. */
function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'retro-border peer group/switch relative inline-flex h-5 w-10 shrink-0 items-center outline-none transition-colors',
        'data-unchecked:bg-base-200 data-checked:bg-accent',
        'data-disabled:cursor-not-allowed data-disabled:opacity-40 aria-invalid:border-error',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          'pointer-events-none block size-4 transition-transform',
          'data-unchecked:translate-x-0 data-unchecked:bg-base-300',
          'data-checked:translate-x-[calc(100%+0.25rem)] data-checked:bg-accent-content',
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
