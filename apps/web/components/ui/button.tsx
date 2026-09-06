import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from 'cn';
import { Slot } from 'radix-ui';

/**
 * §6.1 — as variantes do shadcn são mapeadas nas hook classes do styleguide;
 * a aparência mora no CSS do tema, não aqui. `size` só existe para `icon`.
 */
const buttonVariants = cva(
  "group/button shrink-0 whitespace-nowrap select-none disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'btn-goodchat',
        outline: 'btn-goodchat-outline',
        destructive: 'btn-goodchat-danger',
        ghost: 'icon-btn',
        icon: 'icon-btn',
      },
      size: {
        default: '',
        xs: '',
        sm: '',
        lg: '',
        icon: 'aspect-square px-0',
        'icon-xs': 'aspect-square px-0',
        'icon-sm': 'aspect-square px-0',
        'icon-lg': 'aspect-square px-0',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : 'button';

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
