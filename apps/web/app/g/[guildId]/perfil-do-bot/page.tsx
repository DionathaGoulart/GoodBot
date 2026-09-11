import { ScreenHeader } from '@/components/retro/screen-header';
import { ErrorState } from '@/components/retro/states';
import { hasAccess } from '@/lib/auth/access';
import { requireGuildAccess } from '@/lib/auth/require';
import { loadBotProfile } from '@/lib/bot-profile';

import { BotProfileForm } from './bot-profile-form';

export const metadata = { title: 'Perfil do bot · Goodbot' };

export default async function BotProfilePage({ params }: PageProps<'/g/[guildId]/perfil-do-bot'>) {
  const { guildId } = await params;
  const session = await requireGuildAccess(guildId, 'admin');
  const { profile, error } = await loadBotProfile(guildId);

  return (
    <>
      <ScreenHeader
        kicker="PERFIL DO BOT"
        title="Perfil do bot"
        meta={profile ? `NESTE SERVIDOR · ${profile.displayName.toUpperCase()}` : undefined}
      />
      {profile ? (
        <BotProfileForm profile={profile} readOnly={!hasAccess(session.level, 'admin')} />
      ) : (
        <ErrorState description={error ?? 'O bot não respondeu.'} />
      )}
    </>
  );
}
