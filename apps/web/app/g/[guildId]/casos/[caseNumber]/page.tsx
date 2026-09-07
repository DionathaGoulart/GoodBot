import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Panel } from '@/components/retro/panel';
import { ScreenHeader } from '@/components/retro/screen-header';
import { Tag } from '@/components/retro/tag';
import { hasAccess } from '@/lib/auth/access';
import { requireGuildAccess } from '@/lib/auth/require';
import { CASE_TONES } from '@/lib/case-tones';
import { canSeeDeleted, loadCaseDetail } from '@/lib/cases';
import { formatDuration } from '@cobot/shared';

import { CaseActions } from './case-actions';

import type { CaseRow } from '@/lib/cases';

export const metadata = { title: 'Caso · CoBot' };

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('pt-BR') : '—';
}

/** Link para a mensagem publicada no mod-log, quando ela existe. */
function modlogHref(guildId: string, kase: CaseRow): string | null {
  if (!kase.modlogChannelId || !kase.modlogMessageId) return null;
  return `https://discord.com/channels/${guildId}/${kase.modlogChannelId}/${kase.modlogMessageId}`;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="screen-meta">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

export default async function CasePage({ params }: PageProps<'/g/[guildId]/casos/[caseNumber]'>) {
  const { guildId, caseNumber } = await params;
  const session = await requireGuildAccess(guildId);

  const parsed = Number(caseNumber);
  if (!Number.isInteger(parsed) || parsed <= 0) notFound();

  const includeDeleted = canSeeDeleted(session.level);
  const detail = await loadCaseDetail(guildId, parsed, { includeDeleted });
  if (!detail) notFound();

  const { kase } = detail;
  const modlog = modlogHref(guildId, kase);

  return (
    <>
      <ScreenHeader
        kicker="MODERAÇÃO · CASO"
        title={`#${kase.caseNumber}`}
        meta={`${kase.type.toUpperCase()} EM ${kase.targetTag}`}
        actions={
          <Link href={`/g/${guildId}/casos`} className="icon-btn">
            {'< TODOS OS CASOS'}
          </Link>
        }
      />

      <Panel title="CASO.INF">
        <div className="flex flex-wrap items-center gap-1.5">
          <Tag tone={CASE_TONES[kase.type] ?? 'muted'}>{kase.type}</Tag>
          <Tag tone="muted">{kase.source}</Tag>
          {kase.deletedAt ? <Tag tone="muted">APAGADO</Tag> : null}
          {kase.editedAt ? <Tag tone="muted">EDITADO</Tag> : null}
        </div>

        <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Row label="ALVO">
            <Link href={`/g/${guildId}/membros/${kase.targetId}`} className="underline">
              {kase.targetTag}
            </Link>
            <span className="screen-meta block select-all">{kase.targetId}</span>
          </Row>
          <Row label="MODERADOR">
            <Link href={`/g/${guildId}/membros/${kase.actorId}`} className="underline">
              {kase.actorTag}
            </Link>
            <span className="screen-meta block select-all">{kase.actorId}</span>
          </Row>
          <Row label="MOTIVO">{kase.reason}</Row>
          <Row label="QUANDO">{when(kase.createdAt)}</Row>
          <Row label="DURAÇÃO">
            {kase.durationMs === null ? 'PERMANENTE' : formatDuration(kase.durationMs)}
          </Row>
          <Row label="EXPIRA EM">{when(kase.expiresAt)}</Row>
          {kase.editedAt ? <Row label="EDITADO EM">{when(kase.editedAt)}</Row> : null}
          {kase.deletedAt ? <Row label="APAGADO EM">{when(kase.deletedAt)}</Row> : null}
          <Row label="MOD-LOG">
            {modlog ? (
              <a href={modlog} target="_blank" rel="noreferrer" className="underline">
                ABRIR NO DISCORD
              </a>
            ) : (
              'NÃO PUBLICADO'
            )}
          </Row>
        </dl>
      </Panel>

      <CaseActions detail={detail} canDelete={hasAccess(session.level, 'admin')} />
    </>
  );
}
