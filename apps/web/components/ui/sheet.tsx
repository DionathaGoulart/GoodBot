'use client';

import * as React from 'react';
import { cn } from 'cn';
import { Dialog as SheetPrimitive } from 'radix-ui';

import { Button } from '@/components/ui/button';
import { XIcon } from 'lucide-react';

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger({ ...props }: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose({ ...props }: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetPortal({ ...props }: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn('fixed inset-0 z-50 bg-base-100/80 data-open:animate-enter', className)}
      {...props}
    />
  );
}

function SheetContent({
  className,
  children,
  side = 'right',
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: 'top' | 'right' | 'bottom' | 'left';
  showCloseButton?: boolean;
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          // Largura fica com quem usa: `cn` só concatena (não é `tailwind-merge`),
          // e uma classe com seletor de atributo aqui — `data-[side=right]:w-3/4`
          // — ganharia por especificidade do `w-full sm:max-w-2xl` passado em
          // `className`, prendendo toda sheet em 384px. Sem largura própria a
          // sheet encosta nos dois lados: quem monta uma passa a sua.
          // `h-dvh` e não `h-full`: um elemento `fixed` mede 100% contra o
          // viewport grande, o de barra de endereço recolhida, então no celular
          // o rodapé da sheet — o botão de salvar — ficava atrás da barra do
          // navegador. `dvh` acompanha a barra entrando e saindo.
          'fixed z-50 flex flex-col gap-4 bg-base-200 bg-clip-padding data-open:animate-enter text-sm text-base-content transition duration-200 ease-in-out data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:max-h-dvh data-[side=bottom]:border-t-2 data-[side=bottom]:border-base-300 data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-dvh data-[side=left]:border-r-2 data-[side=left]:border-base-300 data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-dvh data-[side=right]:border-l-2 data-[side=right]:border-base-300 data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:max-h-dvh data-[side=top]:border-b-2 data-[side=top]:border-base-300',
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close data-slot="sheet-close" asChild>
            <Button variant="ghost" className="absolute top-3 right-3" size="icon-sm">
              <XIcon />
              <span className="sr-only">Close</span>
            </Button>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-header"
      // `pr-14` reserva a coluna do botão de fechar: sem ela um título longo
      // passa por baixo do X nas telas estreitas.
      className={cn('flex flex-col gap-0.5 p-4 pr-14', className)}
      {...props}
    />
  );
}

function SheetFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-footer"
      // O `pb` respeita o indicador de home do iPhone; sem ele o botão encosta
      // na barra do sistema e fica difícil de acertar.
      className={cn(
        'mt-auto flex flex-col gap-2 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]',
        className,
      )}
      {...props}
    />
  );
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn('font-heading text-base font-medium text-foreground', className)}
      {...props}
    />
  );
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
};
