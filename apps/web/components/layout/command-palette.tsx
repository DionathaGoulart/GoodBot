'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';

import { navGroupsFor } from './nav';

import type { AccessLevel } from '@/lib/auth/access';

/**
 * §6.9 — com 24 telas, procurar na sidebar custa mais que digitar. `Ctrl+K`
 * (ou `⌘K`) abre a busca e leva a qualquer tela pelo nome ou por um sinônimo.
 */
export function CommandPalette({ guildId, level }: { guildId: string; level: AccessLevel }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const groups = navGroupsFor(level);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey)) return;
      // O `Ctrl+K` do browser é "buscar"; aqui a busca é a nossa.
      event.preventDefault();
      setOpen((current) => !current);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  function go(href: string) {
    setOpen(false);
    router.push(`/g/${guildId}${href}`);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="icon-btn"
        aria-label="Buscar tela"
      >
        BUSCAR
        <span aria-hidden className="text-muted-text">CTRL+K</span>
      </button>

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Buscar tela"
        description="Digite o nome de uma tela do painel."
      >
        <CommandInput placeholder="Ir para…" />
        <CommandList>
          <CommandEmpty>Nenhuma tela com esse nome.</CommandEmpty>
          {groups.map((group) => (
            <CommandGroup key={group.label} heading={group.label}>
              {group.items.map((item) => (
                <CommandItem
                  key={item.href}
                  // O `value` é o que o `command` filtra: nome + sinônimos.
                  value={[item.label, group.label, ...(item.keywords ?? [])].join(' ')}
                  onSelect={() => go(item.href)}
                >
                  {item.label}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>
    </>
  );
}
