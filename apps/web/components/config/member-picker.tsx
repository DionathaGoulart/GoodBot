'use client';

import * as React from 'react';
import { GuildMemberSummarySchema } from '@goodbot/shared';
import { cn } from 'cn';

import { AvatarSq } from '@/components/retro/avatar-sq';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

import type { GuildMemberSummary } from '@goodbot/shared';

/** Espera antes de perguntar ao bot; digitar rápido não vira uma rajada. */
const DEBOUNCE_MS = 250;

async function fetchMembers(query: string, signal: AbortSignal): Promise<GuildMemberSummary[]> {
  const response = await fetch(`/api/discord/members?q=${encodeURIComponent(query)}`, { signal });
  if (!response.ok) throw new Error('O bot não respondeu.');
  return GuildMemberSummarySchema.array().parse(await response.json());
}

/**
 * §6.4 — seletor de membro para os filtros de moderador e alvo. Ao contrário
 * do `DiscordPicker`, a lista não vem inteira: o bot busca no cache dele a
 * cada termo, porque um servidor grande não cabe num popover.
 */
export function MemberPicker({
  value,
  onChange,
  label,
  placeholder = 'Qualquer um',
  id,
}: {
  /** ID do membro, ou `''` para "sem filtro". */
  value: string;
  onChange: (value: string) => void;
  /** Rótulo já conhecido do valor atual (evita um fetch só para mostrar o nome). */
  label?: string;
  placeholder?: string;
  id?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [members, setMembers] = React.useState<GuildMemberSummary[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    // `setLoading` só depois do debounce: mexer no estado no corpo do efeito
    // dispara uma renderização em cascata a cada tecla.
    const timer = setTimeout(() => {
      setLoading(true);
      fetchMembers(query, controller.signal).then(
        (rows) => {
          setMembers(rows);
          setError(null);
          setLoading(false);
        },
        (cause: unknown) => {
          if (controller.signal.aborted) return;
          setError(cause instanceof Error ? cause.message : 'Falha ao buscar.');
          setLoading(false);
        },
      );
    }, DEBOUNCE_MS);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [open, query]);

  const current = members.find((member) => member.id === value);
  const shown = current?.displayName ?? label ?? value;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        id={id}
        type="button"
        className={cn(
          'flex min-h-11 w-full items-center justify-between gap-2 border-2 border-base-300 bg-base-200 px-3 py-1.5 text-left text-sm',
        )}
      >
        {value ? (
          <span className="tag tag-muted">
            @{shown}
            <span
              role="button"
              tabIndex={0}
              aria-label="Limpar"
              className="text-muted-text transition-colors hover:text-accent-text"
              onClick={(event) => {
                event.stopPropagation();
                onChange('');
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                event.stopPropagation();
                onChange('');
              }}
            >
              ×
            </span>
          </span>
        ) : (
          <span className="text-muted-text">{placeholder}</span>
        )}
        <span aria-hidden className="text-muted-text">
          ▼
        </span>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={setQuery} placeholder="Nome, tag ou ID…" />
          <CommandList>
            {loading ? <p className="screen-meta terminal-cursor p-3">BUSCANDO</p> : null}
            {error ? (
              <p className="p-3 text-[10px] uppercase tracking-[0.2em] text-error-text">
                ! {error}
              </p>
            ) : null}
            {!loading && !error && members.length === 0 ? (
              <CommandEmpty>Ninguém encontrado.</CommandEmpty>
            ) : null}
            {members.map((member) => (
              <CommandItem
                key={member.id}
                value={member.id}
                onSelect={() => {
                  onChange(member.id === value ? '' : member.id);
                  setOpen(false);
                }}
              >
                <AvatarSq src={member.avatarUrl} name={member.displayName} size={20} />
                <span className="font-bold">{member.displayName}</span>
                <span className="opacity-60">{member.username}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
