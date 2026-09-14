import { Panel } from '@/components/retro/panel';
import { StatTile } from '@/components/retro/stat-tile';
import { EmptyState } from '@/components/retro/states';
import { SQUAD_FIELD_MATCH_LABEL } from '@/lib/squad-labels';

import { SquadGridHeatmap } from './squad-grid-heatmap';

import type { AnswerSummary, PlayersSummary } from '@/lib/squad-players';
import type { SquadBlockConfig } from '@goodbot/shared';

/** §6.7 — uma barra por opção, contra quantos perfis passaram no filtro. */
function AnswerBars({ answer, base }: { answer: AnswerSummary; base: number }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="section-label">
        {answer.label.toUpperCase()}{' '}
        <span className="text-muted-text">({SQUAD_FIELD_MATCH_LABEL[answer.match]})</span>
      </p>
      {answer.type === 'text' ? (
        <p className="screen-meta">
          {answer.answered} {answer.answered === 1 ? 'RESPONDEU' : 'RESPONDERAM'} · TEXTO LIVRE NÃO
          VIRA CONTAGEM
        </p>
      ) : (
        <>
          {answer.options.map(({ option, count }) => {
            const percent = base === 0 ? 0 : Math.round((count / base) * 100);
            return (
              <div
                key={option}
                className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_2.5rem] items-center gap-3"
              >
                <span className="truncate text-sm" title={option}>
                  {option}
                </span>
                <div
                  className="usage-track"
                  role="progressbar"
                  aria-label={`${answer.label}: ${option}`}
                  aria-valuemin={0}
                  aria-valuemax={base}
                  aria-valuenow={count}
                >
                  <div className="usage-fill" style={{ width: `${String(percent)}%` }} />
                </div>
                <span className="text-right text-sm tabular-nums">{count}</span>
              </div>
            );
          })}
          <p className="screen-meta">SEM RESPOSTA {answer.unanswered}</p>
        </>
      )}
    </div>
  );
}

/** Os contadores da aba JOGADORES: status do jogo inteiro, respostas e grade pelo filtro. */
export function PlayersStats({
  summary,
  blocks,
}: {
  summary: PlayersSummary;
  blocks: readonly SquadBlockConfig[];
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="TOTAL" value={String(summary.total)} />
        <StatTile label="PROCURANDO" value={String(summary.byStatus.searching)} />
        <StatTile label="EM SQUAD" value={String(summary.byStatus.in_squad)} />
        <StatTile label="PAUSADO" value={String(summary.byStatus.paused)} />
      </div>

      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[2fr_1fr]">
        <Panel title="RESPOSTAS.STAT">
          {summary.answers.length === 0 ? (
            <EmptyState description="Este jogo não tem perguntas: o perfil é só a grade de horários." />
          ) : (
            summary.answers.map((answer) => (
              <AnswerBars key={answer.key} answer={answer} base={summary.scoped} />
            ))
          )}
        </Panel>
        <Panel title="GRADE.MAP">
          <SquadGridHeatmap grid={summary.grid} blocks={blocks} />
        </Panel>
      </div>
    </>
  );
}
