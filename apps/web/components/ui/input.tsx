import * as React from 'react';
import { cn } from 'cn';

/** §6.4 — moldura 2px, radius 0, altura fixa; erro vira borda `error`. */
function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'retro-border h-11 w-full min-w-0 bg-base-200 px-3 text-sm text-base-content outline-none transition-colors',
        'placeholder:text-base-content/40 file:inline-flex file:border-0 file:bg-transparent file:text-sm file:font-bold',
        'disabled:pointer-events-none disabled:opacity-40',
        'aria-invalid:border-error',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
