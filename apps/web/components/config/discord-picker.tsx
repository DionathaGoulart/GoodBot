'use client';

import * as React from 'react';
import { GuildChannelSummarySchema, GuildRoleSummarySchema } from '@cobot/shared';
import { cn } from 'cn';

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

import {
  channelsToOptions,
  colorToHex,
  filterOptions,
  rolesToOptions,
  TEXT_CHANNEL_TYPES,
  type DiscordOption,
} from './discord-options';

export type PickerKind = 'channel' | 'role';

/**
 * Uma promessa por tipo, no módulo: a lista de canais é a mesma em todos os
 * pickers da página e o route handler já cacheia 60s do lado do servidor.
 */
const cache = new Map<string, Promise<DiscordOption[]>>();

async function fetchOptions(
  kind: PickerKind,
  types: number[],
  includeEveryone: boolean,
): Promise<DiscordOption[]> {
  const response = await fetch(kind === 'channel' ? '/api/discord/channels' : '/api/discord/roles');
  if (!response.ok) throw new Error('O bot não respondeu.');
  const body: unknown = await response.json();
  return kind === 'channel'
    ? channelsToOptions(GuildChannelSummarySchema.array().parse(body), types)
    : rolesToOptions(GuildRoleSummarySchema.array().parse(body), { includeEveryone });
}

function useDiscordOptions(
  kind: PickerKind,
  types: number[],
  enabled: boolean,
  includeEveryone: boolean,
) {
  // `includeEveryone` entra na chave: as duas listas de cargo convivem no cache.
  const key = kind === 'channel' ? `channel:${types.join(',')}` : `role:${includeEveryone}`;
  // Uma entrada por chave em vez de um `loading` que o efeito precisaria ligar
  // na hora: `loading` vira o simples "abriu e ainda não tem entrada".
  const [loaded, setLoaded] = React.useState<
    Record<string, { options: DiscordOption[]; error: string | null }>
  >({});
  const entry = loaded[key];

  React.useEffect(() => {
    if (!enabled || entry) return;
    let active = true;

    const pending = cache.get(key) ?? fetchOptions(kind, types, includeEveryone);
    cache.set(key, pending);

    pending.then(
      (options) => {
        if (active) setLoaded((current) => ({ ...current, [key]: { options, error: null } }));
      },
      (error: unknown) => {
        // Erro não fica no cache: reabrir o picker tenta de novo.
        cache.delete(key);
        if (active) {
          setLoaded((current) => ({
            ...current,
            [key]: {
              options: [],
              error: error instanceof Error ? error.message : 'Falha ao carregar.',
            },
          }));
        }
      },
    );

    return () => {
      active = false;
    };
    // `types` é um literal novo a cada render; `key` já resume o que importa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, entry]);

  return {
    options: entry?.options ?? [],
    error: entry?.error ?? null,
    loading: enabled && entry === undefined,
  };
}

function Swatch({ option, kind }: { option: DiscordOption; kind: PickerKind }) {
  if (kind === 'channel') return <span aria-hidden>#</span>;
  return (
    <span
      aria-hidden
      className="size-3 border-2 border-base-300"
      style={{ backgroundColor: option.color ? colorToHex(option.color) : 'transparent' }}
    />
  );
}

export interface DiscordPickerProps {
  kind: PickerKind;
  /** Sempre lista; o campo de um ID só manda um array de um item. */
  value: string[];
  onChange: (value: string[]) => void;
  multiple?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** Só para canais; padrão = canais de texto. */
  channelTypes?: number[];
  /** Só para cargos; o `@everyone` só aparece onde ele significa algo. */
  includeEveryone?: boolean;
  id?: string;
}

/**
 * §6.4 — seletor de canal/cargo: `command` com busca, item com `#nome` ou
 * quadradinho na cor do cargo. No modo múltiplo os escolhidos viram `tag`s
 * removíveis dentro do próprio campo.
 */
export function DiscordPicker({
  kind,
  value,
  onChange,
  multiple = false,
  disabled = false,
  placeholder,
  channelTypes = TEXT_CHANNEL_TYPES,
  includeEveryone = false,
  id,
}: DiscordPickerProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  // A lista não serve só para escolher: sem ela o campo fechado não sabe o
  // nome do que já está escolhido e mostraria o snowflake cru. Por isso ela
  // também carrega quando há valor — o cache do módulo evita a repetição.
  const { options, error, loading } = useDiscordOptions(
    kind,
    channelTypes,
    open || value.length > 0,
    includeEveryone,
  );

  const byId = React.useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);
  const visible = React.useMemo(() => filterOptions(options, query), [options, query]);

  const groups = React.useMemo(() => {
    const map = new Map<string, DiscordOption[]>();
    for (const option of visible) {
      const group = option.group ?? '';
      map.set(group, [...(map.get(group) ?? []), option]);
    }
    return [...map];
  }, [visible]);

  function toggle(optionId: string) {
    if (!multiple) {
      onChange(value[0] === optionId ? [] : [optionId]);
      setOpen(false);
      return;
    }
    onChange(value.includes(optionId) ? value.filter((v) => v !== optionId) : [...value, optionId]);
  }

  /**
   * Enquanto a lista não chega, um `…` no lugar do snowflake — o ID cru não
   * diz nada a ninguém. Se ela falhar, o ID volta: dá para copiar e conferir.
   */
  const label = (optionId: string) => byId.get(optionId)?.label ?? (loading ? '…' : optionId);
  const empty = value.length === 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        id={id}
        type="button"
        disabled={disabled}
        className={cn(
          'flex min-h-11 w-full items-center justify-between gap-2 border-2 border-base-300 bg-base-200 px-3 py-1.5 text-left text-sm',
          disabled && 'opacity-40',
        )}
      >
        <span className="flex flex-wrap items-center gap-1.5">
          {empty ? (
            <span className="text-muted-text">
              {placeholder ?? (kind === 'channel' ? 'Nenhum canal' : 'Nenhum cargo')}
            </span>
          ) : (
            value.map((optionId) => (
              <span key={optionId} className="tag tag-muted">
                {kind === 'channel' ? '#' : '@'}
                {label(optionId)}
                {multiple && !disabled ? (
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={`Remover ${label(optionId)}`}
                    className="text-muted-text transition-colors hover:text-accent-text"
                    onClick={(event) => {
                      event.stopPropagation();
                      onChange(value.filter((v) => v !== optionId));
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      event.stopPropagation();
                      onChange(value.filter((v) => v !== optionId));
                    }}
                  >
                    ×
                  </span>
                ) : null}
              </span>
            ))
          )}
        </span>
        <span aria-hidden className="text-muted-text">
          ▼
        </span>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={kind === 'channel' ? 'Buscar canal…' : 'Buscar cargo…'}
          />
          <CommandList>
            {loading ? <p className="screen-meta terminal-cursor p-3">CARREGANDO</p> : null}
            {error ? <p className="p-3 text-[10px] uppercase tracking-[0.2em] text-error-text">! {error}</p> : null}
            {!loading && !error && visible.length === 0 ? (
              <CommandEmpty>Nada encontrado.</CommandEmpty>
            ) : null}
            {groups.map(([group, items]) => (
              <CommandGroup key={group} heading={group || undefined}>
                {items.map((option) => (
                  <CommandItem
                    key={option.id}
                    value={option.id}
                    data-checked={value.includes(option.id)}
                    onSelect={() => toggle(option.id)}
                  >
                    <Swatch option={option} kind={kind} />
                    <span className="truncate">{option.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
