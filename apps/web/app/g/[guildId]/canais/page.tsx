import { ScreenHeader } from '@/components/retro/screen-header';
import { ErrorState } from '@/components/retro/states';
import { hasAccess } from '@/lib/auth/access';
import { requireGuildAccess } from '@/lib/auth/require';
import { loadChannels } from '@/lib/channels';
import { loadRoleNames } from '@/lib/discord';

import { ChannelTree } from './channel-tree';

export const metadata = { title: 'Canais · CoBot' };

export default async function ChannelsPage({ params }: PageProps<'/g/[guildId]/canais'>) {
  const { guildId } = await params;
  const session = await requireGuildAccess(guildId);
  const [{ tree, error }, roleNames] = await Promise.all([
    loadChannels(guildId),
    loadRoleNames(guildId),
  ]);

  return (
    <>
      <ScreenHeader
        kicker="SERVIDOR"
        title="Canais"
        meta="Árvore por categoria. Criar, editar, trancar e ajustar quem vê e quem fala."
      />
      {error ? (
        <ErrorState description={error} />
      ) : (
        <ChannelTree
          tree={tree}
          roleNames={roleNames}
          readOnly={!hasAccess(session.level, 'admin')}
        />
      )}
    </>
  );
}
