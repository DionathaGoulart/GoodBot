import { ScreenHeader } from '@/components/retro/screen-header';
import { hasAccess } from '@/lib/auth/access';
import { requireGuildAccess } from '@/lib/auth/require';
import { CONFIG_PAGES } from '@/lib/config-pages';
import { loadGeneralPage, loadModuleConfig } from '@/lib/module-config';
import { loadTags } from '@/lib/tags';

import { TagsConfigForm } from './form';
import { TagsTable } from './table';

export const metadata = { title: 'Tags · Goodbot' };

export default async function TagsConfigPage({ params }: PageProps<'/g/[guildId]/config/tags'>) {
  const { guildId } = await params;
  const session = await requireGuildAccess(guildId);
  const [{ config }, tags, general] = await Promise.all([
    loadModuleConfig(guildId, 'tags'),
    loadTags(guildId),
    loadGeneralPage(guildId),
  ]);
  const readOnly = !hasAccess(session.level, 'admin');

  return (
    <>
      <ScreenHeader
        kicker="CONFIGURAÇÃO"
        title={CONFIG_PAGES.tags.title}
        meta={CONFIG_PAGES.tags.description}
      />
      <TagsTable tags={tags} embedColor={general.settings.embedColor} readOnly={readOnly} />
      <TagsConfigForm values={config} readOnly={readOnly} />
    </>
  );
}
