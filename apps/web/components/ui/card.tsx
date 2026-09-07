import * as React from 'react';
import { cn } from 'cn';

/** §6.2 — `Card` é o `panel`: moldura 2px, `base-200` e sombra dura. */
function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={cn('panel group/card flex flex-col text-sm text-base-content', className)}
      {...props}
    />
  );
}

/** §4.8 — o header de um card é a barra de título da "janela". */
function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-header" className={cn('window-bar', className)} {...props} />;
}

/** §6.2 — micro-texto, não título grande: o título grande é o da página. */
function CardTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-title"
      className={cn('window-bar-title text-[10px] font-bold uppercase tracking-[0.2em]', className)}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-description"
      className={cn('text-sm leading-relaxed opacity-70', className)}
      {...props}
    />
  );
}

function CardAction({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-action" className={cn('ml-auto', className)} {...props} />;
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-content"
      className={cn('flex flex-col gap-4 p-4 sm:p-6', className)}
      {...props}
    />
  );
}

function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        'flex items-center gap-3 border-t-2 border-base-300 bg-base-100 p-4 sm:px-6',
        className,
      )}
      {...props}
    />
  );
}

export { Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent };
