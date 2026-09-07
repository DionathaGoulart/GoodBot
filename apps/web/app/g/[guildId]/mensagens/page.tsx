import { ScreenHeader } from '@/components/retro/screen-header';
import { ErrorState } from '@/components/retro/states';
import { TEXT_CHANNEL_TYPES } from '@/components/config/discord-options';
import { hasAccess } from '@/lib/auth/access';
import { requireGuildAccess } from '@/lib/auth/require';
import { loadChannelHistory, loadMessageChannels } from '@/lib/messages';
import { loadGeneralPage } from '@/lib/module-config';

import { MessageComposer } from './composer';

export const metadata = { title: 'Mensagens · CoBot' };

/**
 * §6.2 — escrever, editar e apagar mensagens do bot em qualquer canal, com o
 * mesmo editor de embed das telas de config. `mod` vê o histórico; só `admin`
 * escreve (PRD §9.2), e a checagem de verdade está em `lib/messages`.
 */
export default async function MessagesPage({
  params,
  searchParams,
}: PageProps<'/g/[guildId]/mensagens'>) {
  const { guildId } = await params;
  const { canal } = await searchParams;
  const session = await requireGuildAccess(guildId);

  const [{ channels, error }, general] = await Promise.all([
    loadMessageChannels(guildId),
    loadGeneralPage(guildId),
  ]);

  const textChannels = channels
    .filter((channel) => TEXT_CHANNEL_TYPES.some((type) => type === channel.type))
    .sort((a, b) => a.position - b.position);

  const requested = typeof canal === 'string' ? canal : '';
  const selected =
    textChannels.find((channel) => channel.id === requested)?.id ??
    textChannels.find((channel) => channel.canSend !== false)?.id ??
    null;

  const history = selected
    ? await loadChannelHistory(guildId, selected)
    : { messages: [], error: null };

  return (
    <>
      <ScreenHeader
        kicker="COMUNIDADE"
        title="Mensagens"
        meta="Tudo que sai daqui vai para a auditoria com o conteúdo."
      />
      {error ? (
        <ErrorState description={error} />
      ) : (
        <MessageComposer
          guildId={guildId}
          channels={textChannels}
          channelId={selected}
          messages={history.messages}
          historyError={history.error}
          embedColor={general.settings.embedColor}
          readOnly={!hasAccess(session.level, 'admin')}
        />
      )}
    </>
  );
}
