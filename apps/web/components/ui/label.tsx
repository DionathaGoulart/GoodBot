'use client';

import * as React from 'react';
import { cn } from 'cn';
import { Label as LabelPrimitive } from 'radix-ui';

/** §3 — label de formulário: micro-texto bold em caixa alta. */
function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        'flex items-center gap-2 text-xs font-bold uppercase tracking-widest select-none',
        'group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-40 peer-disabled:opacity-40',
        className,
      )}
      {...props}
    />
  );
}

export { Label };
