import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from 'cn';
import { Slot } from 'radix-ui';

/** §6.6 — `tag`: moldura 2px, micro-texto bold, preenchimento sólido. */
const badgeVariants = cva('tag', {
  variants: {
    variant: {
      default: 'tag-accent',
      accent: 'tag-accent',
      error: 'tag-error',
      warning: 'tag-warning',
      info: 'tag-info',
      success: 'tag-success',
      muted: 'tag-muted',
    },
  },
  defaultVariants: { variant: 'default' },
});

function Badge({
  className,
  variant = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'span';

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
