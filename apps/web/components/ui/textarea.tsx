import * as React from 'react';
import { cn } from 'cn';

/** §6.4 — mesma moldura do input; cresce com o conteúdo. */
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'retro-border field-sizing-content min-h-24 w-full bg-base-200 px-3 py-2 text-sm text-base-content outline-none transition-colors',
        'placeholder:text-base-content/40 disabled:pointer-events-none disabled:opacity-40',
        'aria-invalid:border-error',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
