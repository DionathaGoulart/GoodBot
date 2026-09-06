'use client';

import { AvatarSq } from '@/components/retro/avatar-sq';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/** §6.9 — avatar quadrado na topbar; o menu tem o nível e o `SAIR`. */
export function UserMenu({
  name,
  image,
  level,
  onSignOut,
}: {
  name: string;
  image: string | null;
  level: string;
  onSignOut: () => void | Promise<void>;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={`Conta de ${name}`}>
        <AvatarSq name={name} src={image} size={32} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuLabel className="px-3 py-2">
          <span className="block text-sm font-bold">{name}</span>
          <span className="screen-meta">{level.toUpperCase()}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {/* O `onSelect` passa o evento adiante; a server action não pode recebê-lo. */}
        <DropdownMenuItem
          onSelect={() => {
            void onSignOut();
          }}
        >
          SAIR
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
