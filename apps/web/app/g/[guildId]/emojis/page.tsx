import { ScreenHeader } from '@/components/retro/screen-header';
import { ErrorState } from '@/components/retro/states';
import { hasAccess } from '@/lib/auth/access';
import { requireGuildAccess } from '@/lib/auth/require';
import { loadExpressions } from '@/lib/expressions';

import { ExpressionsScreen } from './expressions-screen';

export const metadata = { title: 'Emojis · Goodbot' };

/** §6.3 — emojis e stickers do servidor, com os slots do nível de impulso. */
export default async function ExpressionsPage({ params }: PageProps<'/g/[guildId]/emojis'>) {
  const { guildId } = await params;
  const session = await requireGuildAccess(guildId);
  const { overview, error } = await loadExpressions(guildId);

  return (
    <>
      <ScreenHeader
        kicker="SERVIDOR"
        title="Emojis"
        meta={
          overview
            ? `IMPULSO NÍVEL ${String(overview.limits.premiumTier)} · ${String(overview.emojis.length)} EMOJIS · ${String(overview.stickers.length)} STICKERS`
            : undefined
        }
      />
      {overview ? (
        <ExpressionsScreen overview={overview} readOnly={!hasAccess(session.level, 'admin')} />
      ) : (
        <ErrorState description={error ?? 'O bot não respondeu.'} />
      )}
    </>
  );
}
