'use client';

import * as React from 'react';
import { toast } from 'sonner';

import { checkManualSquadMatchAction, proposeManualSquadAction } from '@/app/actions/squads';
import { Panel } from '@/components/retro/panel';
import { ErrorState } from '@/components/retro/states';
import { Tag } from '@/components/retro/tag';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatSquadCell } from '@/lib/squad-labels';
import { useGuildId } from '@/lib/use-guild-id';

import { withPayload } from './form-data';

import type { SquadBlockConfig, SquadManualCheck, SquadManualIssue } from '@goodbot/shared';

interface Review {
  check: SquadManualCheck | null;
  error: string | null;
}

/** Pede a revisão ao bot. Não mexe em estado: quem chama decide se a resposta ainda vale. */
async function fetchReview(guildId: string, gameId: string, userIds: string[]): Promise<Review> {
  try {
    const result = await checkManualSquadMatchAction(guildId, withPayload({ gameId, userIds }));
    return result.ok
      ? { check: result.check, error: null }
      : { check: null, error: result.message };
  } catch {
    return { check: null, error: 'Não foi possível falar com o servidor.' };
  }
}

/**
 * A revisão antes de propor. Quem calcula é o bot, com linhas frescas e quem
 * saiu do servidor; bloqueio impede confirmar, aviso pede o "li e quero
 * seguir". Confirmar manda as `key`s de todos os avisos exibidos: se o bot
 * achar outro aviso na hora de escrever, a situação mudou, e a revisão volta.
 */
export function MatchDialog({
  open,
  gameId,
  userIds,
  blocks,
  nameOf,
  describe,
  onClose,
}: {
  open: boolean;
  gameId: string;
  userIds: string[];
  blocks: readonly SquadBlockConfig[];
  nameOf: (userId: string) => string;
  describe: (issue: SquadManualIssue) => string;
  /** `true` quando a proposta saiu. */
  onClose: (proposed: boolean) => void;
}) {
  const guildId = useGuildId();
  const [check, setCheck] = React.useState<SquadManualCheck | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [acknowledged, setAcknowledged] = React.useState(false);
  const [stale, setStale] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const selection = userIds.join(',');

  // Abrir limpa a revisão anterior já no render; o efeito abaixo só busca, e
  // aplica a resposta quando ela chega.
  const reviewing = open ? `${gameId}:${selection}` : null;
  const [shown, setShown] = React.useState<string | null>(null);
  if (reviewing !== shown) {
    setShown(reviewing);
    if (reviewing) {
      setStale(false);
      setCheck(null);
      setError(null);
      setAcknowledged(false);
      setLoading(true);
    }
  }

  React.useEffect(() => {
    if (!open) return;
    let current = true;
    void fetchReview(guildId, gameId, selection.split(',')).then((next) => {
      // Fechou antes da resposta: ela não vale mais.
      if (!current) return;
      setCheck(next.check);
      setError(next.error);
      setLoading(false);
    });
    return () => {
      current = false;
    };
  }, [gameId, guildId, open, selection]);

  async function confirm() {
    if (!check) return;
    setSubmitting(true);
    try {
      const result = await proposeManualSquadAction(
        guildId,
        withPayload({
          gameId,
          userIds: check.userIds,
          confirmedWarnings: check.warnings.map((warning) => warning.key),
        }),
      );
      if (result.ok) {
        toast.success('PROPOSTA ABERTA', { description: result.message });
        onClose(true);
        return;
      }
      if (result.stale) {
        setStale(true);
        setLoading(true);
        setAcknowledged(false);
        const next = await fetchReview(guildId, gameId, selection.split(','));
        setCheck(next.check);
        setError(next.error);
        setLoading(false);
        return;
      }
      toast.error('ERRO', { description: result.message });
    } catch {
      toast.error('ERRO', { description: 'Não foi possível falar com o servidor.' });
    } finally {
      setSubmitting(false);
    }
  }

  const blocked = (check?.blocks.length ?? 0) > 0;
  const warned = (check?.warnings.length ?? 0) > 0;
  const canConfirm =
    check !== null && !blocked && (!warned || acknowledged) && !loading && !submitting;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !submitting && onClose(false)}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>PROPOR AO GRUPO</DialogTitle>
          <DialogDescription>
            Abre uma thread privada no canal de busca com ACEITO e PASSO. Ninguém entra em squad sem
            aceitar.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
          {stale ? (
            <p role="status" className="border-2 border-warning p-3 text-sm font-bold">
              ALGO MUDOU DESDE A REVISÃO. CONFIRA DE NOVO.
            </p>
          ) : null}
          {loading ? <p className="screen-meta">REVISANDO_</p> : null}
          {error ? <ErrorState description={error} /> : null}

          {check && !loading ? (
            <>
              <div className="flex flex-col gap-2">
                <p className="section-label">PESSOAS</p>
                <span className="flex flex-wrap gap-1">
                  {check.userIds.map((userId) => (
                    <Tag key={userId} tone="muted">
                      {nameOf(userId)}
                    </Tag>
                  ))}
                </span>
              </div>

              <div className="flex flex-col gap-1">
                <p className="section-label">HORÁRIO EM COMUM</p>
                <p className="text-sm">
                  {check.slot
                    ? formatSquadCell(check.slot.day, check.slot.block, blocks)
                    : 'SEM HORÁRIO EM COMUM'}
                </p>
              </div>

              {check.pairs.length > 0 ? (
                <div className="flex flex-col gap-1">
                  <p className="section-label">DUPLAS · NOTA {check.score}</p>
                  <ul className="flex flex-col gap-1 text-sm">
                    {check.pairs.map((pair) => (
                      <li key={pair.userIds.join(':')} className="flex flex-wrap items-center gap-1">
                        <span>
                          {nameOf(pair.userIds[0])} + {nameOf(pair.userIds[1])}
                        </span>
                        <span className="font-bold tabular-nums">{pair.score}</span>
                        <span className="screen-meta">
                          {pair.commonCells} {pair.commonCells === 1 ? 'FAIXA' : 'FAIXAS'}
                        </span>
                        {pair.hardConflicts.length > 0 ? <Tag tone="error">PRECISA BATER</Tag> : null}
                        {pair.cooldown ? <Tag tone="warning">PAUSA</Tag> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {blocked ? (
                <Panel title="BLOQUEIOS" tone="error">
                  <ul className="flex list-inside list-disc flex-col gap-1 text-sm">
                    {check.blocks.map((issue) => (
                      <li key={issue.key}>{describe(issue)}</li>
                    ))}
                  </ul>
                </Panel>
              ) : null}

              {warned ? (
                <Panel title="AVISOS" tone="warning">
                  <ul className="flex list-inside list-disc flex-col gap-1 text-sm">
                    {check.warnings.map((issue) => (
                      <li key={issue.key}>{describe(issue)}</li>
                    ))}
                  </ul>
                  {blocked ? null : (
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        aria-label="Li os avisos e quero seguir mesmo assim"
                        checked={acknowledged}
                        onCheckedChange={(next) => setAcknowledged(next === true)}
                      />
                      Li os avisos e quero seguir mesmo assim
                    </label>
                  )}
                </Panel>
              ) : null}
            </>
          ) : null}
        </div>

        <DialogFooter>
          <button
            type="button"
            className="btn-goodchat-outline"
            disabled={submitting}
            onClick={() => onClose(false)}
          >
            CANCELAR
          </button>
          <button type="button" className="btn-goodchat" disabled={!canConfirm} onClick={confirm}>
            {submitting ? 'ENVIANDO_' : 'CONFIRMAR'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
