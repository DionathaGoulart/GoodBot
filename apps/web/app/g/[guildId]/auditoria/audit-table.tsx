'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

import Link from 'next/link';

import { JsonDiff } from '@/components/json-diff';
import { MemberPicker } from '@/components/config/member-picker';
import { MultiSelect } from '@/components/multi-select';
import { Tag } from '@/components/retro/tag';
import { EmptyState } from '@/components/retro/states';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AUDIT_SOURCE_LABEL,
  AUDIT_SOURCE_OPTIONS,
  AUDIT_SOURCE_TONES,
  auditTargetHref,
} from '@/lib/audit-sources';
import { auditFiltersToQuery, EMPTY_AUDIT_FILTERS, type AuditFilters } from '@/lib/case-filters';

import type { AuditRow } from '@/lib/audit';

/** Valor do `Select` para "sem filtro"; o Radix não aceita item com valor ''. */
const ANY = '__todas__';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-40 flex-1 flex-col gap-1.5">
      <Label className="screen-meta">{label}</Label>
      {children}
    </div>
  );
}

function AuditFiltersBar({
  basePath,
  filters,
  actions,
}: {
  basePath: string;
  filters: AuditFilters;
  actions: string[];
}) {
  const router = useRouter();
  // Começa na URL; o pai remonta a barra por `key` quando a URL muda.
  const [draft, setDraft] = React.useState(filters);

  const patch = (next: Partial<AuditFilters>) =>
    setDraft((current) => ({ ...current, ...next, page: 1 }));

  const go = (next: AuditFilters) => {
    const query = auditFiltersToQuery({ ...next, page: 1 }).toString();
    router.push(query ? `${basePath}?${query}` : basePath);
  };

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        go(draft);
      }}
    >
      <Field label="ATOR">
        <MemberPicker value={draft.actorId} onChange={(actorId) => patch({ actorId })} />
      </Field>
      <Field label="AÇÃO">
        <Select
          value={draft.action || ANY}
          onValueChange={(action) => patch({ action: action === ANY ? '' : action })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Todas" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Todas</SelectItem>
            {actions.map((action) => (
              <SelectItem key={action} value={action}>
                {action}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="ORIGEM">
        <MultiSelect
          label="Origem"
          options={AUDIT_SOURCE_OPTIONS}
          value={draft.source}
          onChange={(source) => patch({ source: source as AuditFilters['source'] })}
        />
      </Field>
      <Field label="DE">
        <Input
          type="date"
          value={draft.from}
          max={draft.to || undefined}
          onChange={(event) => patch({ from: event.target.value })}
        />
      </Field>
      <Field label="ATÉ">
        <Input
          type="date"
          value={draft.to}
          min={draft.from || undefined}
          onChange={(event) => patch({ to: event.target.value })}
        />
      </Field>
      <Field label="BUSCA">
        <Input
          value={draft.q}
          placeholder="AÇÃO, ATOR OU ALVO"
          onChange={(event) => patch({ q: event.target.value })}
        />
      </Field>
      <div className="flex gap-2">
        <button type="submit" className="btn-goodchat">
          FILTRAR
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => {
            setDraft(EMPTY_AUDIT_FILTERS);
            go(EMPTY_AUDIT_FILTERS);
          }}
        >
          LIMPAR
        </button>
      </div>
    </form>
  );
}

/** O alvo vira link quando existe uma página para ele (Etapa 22). */
function TargetCell({ guildId, row }: { guildId: string; row: AuditRow }) {
  if (!row.targetType) return <span className="screen-meta">—</span>;

  const href = auditTargetHref(guildId, row);
  const body = (
    <span className="text-sm">
      {row.targetType}
      {row.targetId ? <span className="screen-meta block select-all">{row.targetId}</span> : null}
    </span>
  );

  return href ? (
    <Link
      href={href}
      prefetch={false}
      className="underline decoration-accent decoration-2 underline-offset-2"
      onClick={(event) => event.stopPropagation()}
    >
      {body}
    </Link>
  ) : (
    body
  );
}

/**
 * §6.3/§6.5 — a auditoria não usa a `DataTable`: cada linha abre num diff, e
 * uma `<tr>` que vira duas quando expande é mais simples aqui do que uma
 * coluna extra na tabela genérica.
 */
export function AuditTable({
  guildId,
  basePath,
  filters,
  rows,
  actions,
}: {
  guildId: string;
  basePath: string;
  filters: AuditFilters;
  rows: AuditRow[];
  actions: string[];
}) {
  const [open, setOpen] = React.useState<number | null>(null);

  return (
    <div className="flex flex-col gap-3">
      <AuditFiltersBar
        key={auditFiltersToQuery(filters).toString()}
        basePath={basePath}
        filters={filters}
        actions={actions}
      />

      {rows.length === 0 ? (
        <EmptyState description="Nenhuma ação com esses filtros." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="screen-meta p-2 text-left">ORIGEM</th>
                <th className="screen-meta p-2 text-left">ATOR</th>
                <th className="screen-meta p-2 text-left">AÇÃO</th>
                <th className="screen-meta p-2 text-left">ALVO</th>
                <th className="screen-meta p-2 text-left">QUANDO</th>
                <th className="screen-meta p-2 text-right">DIFF</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <React.Fragment key={row.id}>
                  <tr
                    className="cursor-pointer border-t-2 border-base-300/30"
                    onClick={() => setOpen(open === row.id ? null : row.id)}
                  >
                    <td className="p-2">
                      <Tag tone={AUDIT_SOURCE_TONES[row.source]}>
                        {AUDIT_SOURCE_LABEL[row.source]}
                      </Tag>
                    </td>
                    <td className="p-2">
                      <span className="font-bold">{row.actorTag}</span>
                      <span className="screen-meta block select-all">{row.actorId}</span>
                    </td>
                    <td className="p-2">
                      <Tag tone="muted">{row.action}</Tag>
                    </td>
                    <td className="p-2">
                      <TargetCell guildId={guildId} row={row} />
                    </td>
                    <td className="p-2">
                      <time dateTime={row.createdAt} title={row.createdAt} className="screen-meta">
                        {new Date(row.createdAt).toLocaleString('pt-BR')}
                      </time>
                    </td>
                    <td className="p-2 text-right">
                      <span aria-hidden className="icon-btn">
                        {open === row.id ? '▲' : '▼'}
                      </span>
                    </td>
                  </tr>
                  {open === row.id ? (
                    <tr className="border-t-2 border-base-300/30">
                      <td colSpan={6} className="bg-base-100 p-4">
                        {row.reason ? (
                          <p className="pb-3 text-sm">
                            <span className="screen-meta pr-2">MOTIVO</span>
                            {row.reason}
                          </p>
                        ) : null}
                        <JsonDiff before={row.before} after={row.after} />
                        <p className="screen-meta pt-3">
                          {row.source === 'dashboard'
                            ? `${row.ip ? `IP ${row.ip}` : 'IP DESCONHECIDO'}${
                                row.userAgent ? ` · ${row.userAgent}` : ''
                              }`
                            : 'AÇÃO DO PRÓPRIO BOT — SEM REQUISIÇÃO HTTP'}
                        </p>
                      </td>
                    </tr>
                  ) : null}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
