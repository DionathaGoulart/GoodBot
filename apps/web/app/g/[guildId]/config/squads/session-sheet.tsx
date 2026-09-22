'use client';

import { formatPlaytime, type SessionSummary } from '@goodbot/shared';

import { Tag } from '@/components/retro/tag';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { formatSessionStart } from '@/lib/squad-labels';

import { SESSION_STATUS_LABEL, SESSION_STATUS_TONE } from './sessions-table';

import type { SessionTableRow } from '@/lib/squad-sessions';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="section-label">{title}</h3>
      {children}
    </section>
  );
}

/** "@a (2 h), @b (40 min)"; lista vazia vira um traço, como no embed do bot. */
function PlaytimeList({
  people,
  names,
}: {
  people: readonly { userId: string; ms: number }[];
  names: (userId: string) => string;
}) {
  if (people.length === 0) return <p className="screen-meta">—</p>;
  return (
    <ul className="flex flex-col gap-1">
      {people.map((person) => (
        <li key={person.userId} className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-sm">{names(person.userId)}</span>
          <span className="screen-meta tabular-nums">{formatPlaytime(person.ms)}</span>
        </li>
      ))}
    </ul>
  );
}

/** As formações da jogatina em prosa, como o relatório do bot escreve. */
function formationsText(report: SessionSummary): string {
  return report.formations.bySize
    .filter((size) => size.ms > 0)
    // Empate no tempo: o grupo maior primeiro, que é o que o squad persegue.
    .sort((a, b) => b.ms - a.ms || b.size - a.size)
    .map((size) => {
      const party =
        size.party === 'full'
          ? ' (party cheia)'
          : size.party === 'over'
            ? ' (mais que uma party)'
            : '';
      const label = size.size === 1 ? size.label : `de ${size.label}`;
      return `${formatPlaytime(size.ms)} ${label}${party}`;
    })
    .join(', ');
}

/** A frase de abertura: quanto durou, ou por que não há número. */
function headline(row: SessionTableRow, report: SessionSummary): string {
  switch (report.outcome) {
    case 'measured':
      return row.status === 'running'
        ? `Está rolando agora: ${formatPlaytime(report.durationMs)} até aqui.`
        : `Durou ${formatPlaytime(report.durationMs)}.`;
    case 'unmeasured':
      return 'Rolou, mas sem ninguém no voice reservado: não dá para medir o tempo. Vale quem disse VOU.';
    default:
      return 'Não rolou: ninguém apareceu.';
  }
}

/**
 * O relatório de uma jogatina, o mesmo que o bot posta no canal do squad
 * quando ela encerra: duração, quem jogou com o tempo de cada um, convidados,
 * formações, quem faltou e quem apareceu sem avisar.
 */
export function SessionSheet({
  row,
  names,
  timeZone,
  onClose,
}: {
  row: SessionTableRow | null;
  names: (userId: string) => string;
  timeZone: string;
  onClose: () => void;
}) {
  if (!row) {
    return (
      <Sheet open={false}>
        <SheetContent className="w-full sm:max-w-lg" />
      </Sheet>
    );
  }

  const { report } = row;
  const played = report?.players.filter((player) => player.status !== 'no_show') ?? [];
  const missed = report?.players.filter((player) => player.status === 'no_show') ?? [];
  const walkIns = report?.players.filter((player) => player.status === 'walk_in') ?? [];
  const formations = report ? formationsText(report) : '';

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{row.squadName}</SheetTitle>
          <SheetDescription>
            <time dateTime={row.startsAt}>{formatSessionStart(row.startsAt, timeZone)}</time>
          </SheetDescription>
          <div className="flex flex-wrap items-center gap-2">
            <Tag tone={SESSION_STATUS_TONE[row.status]}>{SESSION_STATUS_LABEL[row.status]}</Tag>
            <span className="screen-meta">
              {row.goingCount} {row.goingCount === 1 ? 'DISSE VOU' : 'DISSERAM VOU'}
            </span>
          </div>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 pb-6">
          {report ? (
            <p className="text-sm leading-relaxed">{headline(row, report)}</p>
          ) : (
            <p className="text-sm leading-relaxed">
              {row.status === 'cancelled'
                ? 'Cancelada antes de começar. Quem tinha dito VOU foi avisado no canal do squad.'
                : 'Ainda não começou. Os números saem quando a jogatina rolar.'}
            </p>
          )}

          {report && report.outcome !== 'not_played' ? (
            <Section title={report.outcome === 'unmeasured' ? 'DISSERAM QUE IAM' : 'QUEM JOGOU'}>
              <PlaytimeList people={played} names={names} />
            </Section>
          ) : null}

          {report && report.guests.length > 0 ? (
            <Section title="CONVIDADOS">
              <PlaytimeList people={report.guests} names={names} />
            </Section>
          ) : null}

          {formations ? (
            <Section title="FORMAÇÕES">
              <p className="text-sm leading-relaxed">{formations}</p>
            </Section>
          ) : null}

          {missed.length > 0 ? (
            <Section title="FALTARAM">
              <p className="text-sm">{missed.map((player) => names(player.userId)).join(', ')}</p>
            </Section>
          ) : null}

          {walkIns.length > 0 ? (
            <Section title="APARECERAM SEM AVISAR">
              <p className="text-sm">{walkIns.map((player) => names(player.userId)).join(', ')}</p>
            </Section>
          ) : null}

          {report?.open ? (
            <p className="screen-meta">
              ALGUÉM AINDA ESTÁ NO VOICE: OS TEMPOS SOBEM ATÉ A SALA ESVAZIAR
            </p>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
