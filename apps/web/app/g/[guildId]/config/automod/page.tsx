import { ScreenHeader } from '@/components/retro/screen-header';
import { hasAccess } from '@/lib/auth/access';
import { requireGuildAccess } from '@/lib/auth/require';
import { loadAutomodRules, loadRaidState } from '@/lib/automod';
import { CONFIG_PAGES } from '@/lib/config-pages';
import { loadModuleConfig } from '@/lib/module-config';

import { AutomodConfigForm } from './form';
import { RaidCard } from './raid-card';
import { AutomodRulesTable } from './rules-table';

export const metadata = { title: 'Automod · Goodbot' };

export default async function AutomodConfigPage({
  params,
}: PageProps<'/g/[guildId]/config/automod'>) {
  const { guildId } = await params;
  const session = await requireGuildAccess(guildId);
  const [{ config }, rules, raid] = await Promise.all([
    loadModuleConfig(guildId, 'automod'),
    loadAutomodRules(guildId),
    loadRaidState(guildId),
  ]);
  const readOnly = !hasAccess(session.level, 'admin');

  return (
    <>
      <ScreenHeader
        kicker="CONFIGURAÇÃO"
        title={CONFIG_PAGES.automod.title}
        meta={CONFIG_PAGES.automod.description}
      />
      <RaidCard state={raid} readOnly={readOnly} />
      <AutomodRulesTable rules={rules} readOnly={readOnly} />
      <AutomodConfigForm values={config} readOnly={readOnly} />
    </>
  );
}
