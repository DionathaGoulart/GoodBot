import { ScreenHeader } from '@/components/retro/screen-header';
import { ErrorState } from '@/components/retro/states';
import { hasAccess } from '@/lib/auth/access';
import { requireGuildAccess } from '@/lib/auth/require';
import { loadGuildProfile } from '@/lib/guild';

import { ServerForm } from './server-form';

export const metadata = { title: 'Servidor · Goodbot' };

export default async function ServerPage({ params }: PageProps<'/g/[guildId]/servidor'>) {
  const { guildId } = await params;
  const session = await requireGuildAccess(guildId);
  const { profile, error } = await loadGuildProfile(guildId);

  return (
    <>
      <ScreenHeader
        kicker="SERVIDOR"
        title="Servidor"
        meta={
          profile
            ? `${String(profile.memberCount)} MEMBROS · IMPULSO NÍVEL ${String(profile.premiumTier)}`
            : undefined
        }
      />
      {profile ? (
        <ServerForm profile={profile} readOnly={!hasAccess(session.level, 'admin')} />
      ) : (
        <ErrorState description={error ?? 'O bot não respondeu.'} />
      )}
    </>
  );
}
