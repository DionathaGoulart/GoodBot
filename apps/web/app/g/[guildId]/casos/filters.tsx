'use client';

import * as React from 'react';
import { CASE_SOURCES, CASE_TYPES } from '@cobot/shared';
import { useRouter } from 'next/navigation';

import { MemberPicker } from '@/components/config/member-picker';
import { MultiSelect } from '@/components/multi-select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { caseFiltersToQuery, EMPTY_CASE_FILTERS, type CaseFilters } from '@/lib/case-filters';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-40 flex-1 flex-col gap-1.5">
      <Label className="screen-meta">{label}</Label>
      {children}
    </div>
  );
}

/**
 * §6.3 — a barra de filtros da tabela de casos. Ela não filtra nada sozinha:
 * monta a URL e navega, porque o estado da tela é a URL (PRD §6.4) e a busca
 * acontece no Postgres.
 */
export function CaseFiltersBar({
  basePath,
  filters,
  actorLabel,
  targetLabel,
}: {
  basePath: string;
  filters: CaseFilters;
  actorLabel?: string;
  targetLabel?: string;
}) {
  const router = useRouter();
  // O rascunho começa no filtro da URL. Quem manda é a URL: a página remonta
  // este componente por `key` quando ela muda, então não há efeito de sync.
  const [draft, setDraft] = React.useState(filters);

  const patch = (next: Partial<CaseFilters>) =>
    setDraft((current) => ({ ...current, ...next, page: 1 }));

  const go = (next: CaseFilters) => {
    const query = caseFiltersToQuery({ ...next, page: 1 }).toString();
    router.push(query ? `${basePath}?${query}` : basePath);
  };

  const exportQuery = caseFiltersToQuery({ ...filters, page: 1 }).toString();

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        go(draft);
      }}
    >
      <div className="flex flex-wrap gap-3">
        <Field label="TIPO">
          <MultiSelect
            label="Tipo"
            options={CASE_TYPES}
            value={draft.type}
            onChange={(type) => patch({ type: type as CaseFilters['type'] })}
          />
        </Field>
        <Field label="ORIGEM">
          <MultiSelect
            label="Origem"
            options={CASE_SOURCES}
            value={draft.source}
            onChange={(source) => patch({ source: source as CaseFilters['source'] })}
          />
        </Field>
        <Field label="MODERADOR">
          <MemberPicker
            value={draft.actorId}
            label={actorLabel}
            onChange={(actorId) => patch({ actorId })}
          />
        </Field>
        <Field label="ALVO">
          <MemberPicker
            value={draft.targetId}
            label={targetLabel}
            onChange={(targetId) => patch({ targetId })}
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-end gap-3">
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
        <Field label="MOTIVO OU CASO">
          <Input
            value={draft.q}
            placeholder="SPAM, #42, NOME…"
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
              setDraft(EMPTY_CASE_FILTERS);
              go(EMPTY_CASE_FILTERS);
            }}
          >
            LIMPAR
          </button>
          <a
            className="icon-btn"
            href={`/api/cases/export${exportQuery ? `?${exportQuery}` : ''}`}
            download
          >
            CSV
          </a>
        </div>
      </div>
    </form>
  );
}
