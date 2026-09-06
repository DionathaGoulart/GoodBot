'use client';

import * as React from 'react';
import { cn } from 'cn';

/** §6.3 — a tabela vive dentro da própria moldura e rola só na horizontal. */
function Table({ className, ...props }: React.ComponentProps<'table'>) {
  return (
    <div data-slot="table-container" className="panel relative w-full overflow-x-auto">
      <table
        data-slot="table"
        className={cn('data-table w-full caption-bottom text-sm', className)}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return (
    <thead
      data-slot="table-header"
      className={cn('bg-base-100 [&_tr]:border-b-2 [&_tr]:border-base-300', className)}
      {...props}
    />
  );
}

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return <tbody data-slot="table-body" className={cn('', className)} {...props} />;
}

function TableFooter({ className, ...props }: React.ComponentProps<'tfoot'>) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn('border-t-2 border-base-300 bg-base-100 font-bold', className)}
      {...props}
    />
  );
}

/**
 * §6.3 — linha comum não levanta: faz *fill*. "Levantar" é só para o que é
 * cartão (§4.9). A linha selecionada inunda de accent.
 */
function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        'border-b border-base-300/30 transition-colors',
        'hover:bg-base-content/8 data-[state=selected]:bg-accent data-[state=selected]:text-accent-content',
        className,
      )}
      {...props}
    />
  );
}

/** §3 — cabeçalho é micro-texto: 10px, black, `tracking-[0.2em]`. */
function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        'px-4 py-3 text-left align-middle text-[10px] font-black uppercase tracking-[0.2em] whitespace-nowrap opacity-60',
        '[&:has([role=checkbox])]:pr-0',
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return (
    <td
      data-slot="table-cell"
      className={cn('px-4 py-3 align-middle [&:has([role=checkbox])]:pr-0', className)}
      {...props}
    />
  );
}

function TableCaption({ className, ...props }: React.ComponentProps<'caption'>) {
  return (
    <caption
      data-slot="table-caption"
      className={cn('mt-4 text-[10px] uppercase tracking-[0.2em] opacity-60', className)}
      {...props}
    />
  );
}

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };
