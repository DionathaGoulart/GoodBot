'use client';

import * as React from 'react';
import { cn } from 'cn';
import { Separator as SeparatorPrimitive } from 'radix-ui';

/** Linha de 2px em `base-300` — a moldura do retro nunca é sutil (§4.2). */
function Separator({
  className,
  orientation = 'horizontal',
  decorative = true,
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn(
        'shrink-0 bg-base-300 data-horizontal:h-0.5 data-horizontal:w-full data-vertical:w-0.5 data-vertical:self-stretch',
        className,
      )}
      {...props}
    />
  );
}

export { Separator };
