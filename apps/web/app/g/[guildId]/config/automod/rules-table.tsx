'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import {
  deleteAutomodRuleAction,
  reorderAutomodRulesAction,
} from '@/app/actions/modules';
import { ConfirmButton } from '@/components/config/confirm-button';
import { DataTable, moveRow, type PanelColumnDef } from '@/components/data-table';
import { Panel } from '@/components/retro/panel';
import { Tag } from '@/components/retro/tag';

import { emptyRule } from './rule-defaults';
import { RuleSheet, type RuleEditing } from './rule-sheet';

import type { AutomodRuleRow } from '@/lib/automod';

export function AutomodRulesTable({
  rules,
  readOnly,
}: {
  rules: AutomodRuleRow[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<RuleEditing | null>(null);
  const [reordering, setReordering] = React.useState(false);

  const reorder = React.useCallback(
    async (index: number, delta: -1 | 1) => {
      const next = moveRow(
        rules.map((rule) => rule.id),
        index,
        delta,
      );
      if (!next) return;
      setReordering(true);
      try {
        const formData = new FormData();
        formData.set('ruleIds', JSON.stringify(next));
        const result = await reorderAutomodRulesAction(formData);
        if (result.ok) {
          router.refresh();
        } else {
          toast.error('ERRO', { description: result.message });
        }
      } finally {
        setReordering(false);
      }
    },
    [rules, router],
  );

  const columns = React.useMemo<PanelColumnDef<AutomodRuleRow>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'NOME',
        cell: ({ row }) => (
          <span className="font-bold">
            {row.original.name}
            {row.original.rule ? null : (
              <span className="ml-2 text-error-text">! CONFIG INVÁLIDO</span>
            )}
          </span>
        ),
      },
      {
        accessorKey: 'type',
        header: 'TIPO',
        cell: ({ row }) => <Tag>{row.original.type}</Tag>,
      },
      {
        accessorKey: 'enabled',
        header: 'ESTADO',
        cell: ({ row }) => (
          <Tag tone={row.original.enabled ? 'success' : 'muted'}>
            {row.original.enabled ? 'ATIVA' : 'PAUSADA'}
          </Tag>
        ),
      },
      {
        accessorKey: 'hits24h',
        header: 'HITS 24H',
        cell: ({ row }) => <span className="tabular-nums">{row.original.hits24h}</span>,
      },
      {
        id: 'actions',
        header: 'AÇÕES',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="flex flex-wrap gap-1">
            {row.original.actions.map((action) => (
              <Tag key={action} tone="muted">
                {action}
              </Tag>
            ))}
          </span>
        ),
      },
      {
        id: 'controls',
        header: '',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="flex justify-end gap-2">
            {readOnly ? null : (
              <>
                <button
                  type="button"
                  className="icon-btn"
                  disabled={reordering || row.index === 0}
                  onClick={() => void reorder(row.index, -1)}
                  aria-label="Subir prioridade"
                >
                  ▲
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  disabled={reordering || row.index === rules.length - 1}
                  onClick={() => void reorder(row.index, 1)}
                  aria-label="Descer prioridade"
                >
                  ▼
                </button>
              </>
            )}
            <button
              type="button"
              className="icon-btn"
              disabled={!row.original.rule}
              onClick={() =>
                row.original.rule && setEditing({ rule: row.original.rule, id: row.original.id })
              }
            >
              {readOnly ? 'VER' : 'EDITAR'}
            </button>
            {readOnly ? null : (
              <ConfirmButton
                action={() => {
                  const formData = new FormData();
                  formData.set('ruleId', row.original.id);
                  return deleteAutomodRuleAction(formData);
                }}
                successMessage={`A regra ${row.original.name} foi removida.`}
                onDone={() => router.refresh()}
              />
            )}
          </span>
        ),
      },
    ],
    [readOnly, reorder, reordering, router, rules.length],
  );

  return (
    <Panel
      title="REGRAS.LST"
      actions={
        readOnly ? null : (
          <button
            type="button"
            className="icon-btn"
            onClick={() => setEditing({ rule: emptyRule(), id: null })}
          >
            NOVA REGRA
          </button>
        )
      }
    >
      <DataTable
        columns={columns}
        data={rules}
        searchPlaceholder="BUSCAR REGRA"
        refetching={reordering}
        emptyDescription="Nenhuma regra criada. Uma regra diz o que filtrar e o que fazer quando filtrar."
        emptyAction={
          readOnly ? undefined : (
            <button
              type="button"
              className="btn-goodchat-outline"
              onClick={() => setEditing({ rule: emptyRule(), id: null })}
            >
              CRIAR REGRA
            </button>
          )
        }
      />
      <p className="screen-meta">
        A ORDEM DA TABELA É A ORDEM DE AVALIAÇÃO · A PRIMEIRA QUE DISPARA VENCE
      </p>

      <RuleSheet
        editing={editing}
        readOnly={readOnly}
        onClose={(changed) => {
          setEditing(null);
          if (changed) router.refresh();
        }}
      />
    </Panel>
  );
}
