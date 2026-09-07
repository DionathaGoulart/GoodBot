import { notFound } from 'next/navigation';

import { AvatarSq } from '@/components/retro/avatar-sq';
import { Panel } from '@/components/retro/panel';
import { ScreenHeader } from '@/components/retro/screen-header';
import { ErrorState } from '@/components/retro/states';
import { Tag } from '@/components/retro/tag';
import { hasAccess } from '@/lib/auth/access';
import { requireGuildAccess } from '@/lib/auth/require';
import { loadRoleNames } from '@/lib/discord';
import { loadMember, loadMemberCases, MEMBER_CASES_LIMIT } from '@/lib/members';

import { MemberCases } from './member-cases';
import { MemberModeration } from './member-moderation';
import { MemberRoles } from './member-roles';

import type { GuildMemberDetail } from '@cobot/shared';

export const metadata = { title: 'Membro · CoBot' };

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('pt-BR') : '—';
}

function Identity({ member }: { member: GuildMemberDetail }) {
  return (
    <Panel title="MEMBRO.INF">
      <div className="flex flex-wrap items-start gap-4">
        <AvatarSq src={member.avatarUrl} name={member.displayName} size={64} />
        <div className="flex flex-col gap-1">
          <p className="screen-title text-xl">{member.displayName}</p>
          <p className="screen-meta">{member.username}</p>
          <p className="screen-meta select-all">{member.id}</p>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {member.bot ? <Tag tone="muted">BOT</Tag> : null}
            {member.pending ? <Tag tone="warning">NÃO VERIFICADO</Tag> : null}
            {member.communicationDisabledUntil ? (
              <Tag tone="warning">DE CASTIGO ATÉ {when(member.communicationDisabledUntil)}</Tag>
            ) : null}
          </div>
        </div>
        <dl className="ml-auto grid gap-1 text-sm">
          <div className="flex gap-2">
            <dt className="screen-meta">ENTROU</dt>
            <dd>{when(member.joinedAt)}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="screen-meta">CONTA CRIADA</dt>
            <dd>{when(member.createdAt)}</dd>
          </div>
        </dl>
      </div>
    </Panel>
  );
}

export default async function MemberPage({ params }: PageProps<'/g/[guildId]/membros/[userId]'>) {
  const { guildId, userId } = await params;
  const session = await requireGuildAccess(guildId);

  let member: GuildMemberDetail;
  try {
    member = await loadMember(guildId, userId);
  } catch (error) {
    // Membro que saiu do servidor não tem página; o resto é o bot fora do ar.
    if (error instanceof Error && error.message.includes('não está no servidor')) notFound();
    return (
      <>
        <ScreenHeader kicker="SERVIDOR" title="Membro" />
        <ErrorState description="O bot não respondeu; não dá para abrir este membro agora." />
      </>
    );
  }

  const [cases, roleNames] = await Promise.all([
    loadMemberCases(guildId, userId),
    loadRoleNames(guildId),
  ]);
  const isAdmin = hasAccess(session.level, 'admin');

  return (
    <>
      <ScreenHeader
        kicker="SERVIDOR · MEMBRO"
        title={member.displayName}
        meta={`${cases.total} caso${cases.total === 1 ? '' : 's'} registrado${cases.total === 1 ? '' : 's'}`}
      />
      <Identity member={member} />
      <MemberModeration member={member} />
      <MemberRoles member={member} roleNames={roleNames} readOnly={!isAdmin} />
      <MemberCases
        rows={cases.rows}
        total={cases.total}
        limit={MEMBER_CASES_LIMIT}
        guildId={guildId}
      />
    </>
  );
}
