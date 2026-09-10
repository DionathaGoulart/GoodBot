import { ScreenHeader } from '@/components/retro/screen-header';
import { hasAccess } from '@/lib/auth/access';
import { requireGuildAccess } from '@/lib/auth/require';
import { loadCommands } from '@/lib/commands';
import { CONFIG_PAGES } from '@/lib/config-pages';
import { loadModuleConfig } from '@/lib/module-config';
import { ErrorState } from '@/components/retro/states';

import { CommandsForm } from './table';

export const metadata = { title: 'Comandos · Goodbot' };

export default async function CommandsConfigPage({
  params,
}: PageProps<'/g/[guildId]/config/commands'>) {
  const { guildId } = await params;
  const session = await requireGuildAccess(guildId);
  const [{ config }, commands] = await Promise.all([
    loadModuleConfig(guildId, 'utilities'),
    loadCommands(guildId),
  ]);
  const readOnly = !hasAccess(session.level, 'admin');

  return (
    <>
      <ScreenHeader
        kicker="CONFIGURAÇÃO"
        title={CONFIG_PAGES.commands.title}
        meta={CONFIG_PAGES.commands.description}
      />
      {commands === null ? (
        // §8 — a lista é o manifesto vivo do bot: sem ele não há o que editar.
        <ErrorState description="O bot não respondeu, então não dá para listar os comandos agora." />
      ) : (
        <CommandsForm values={config} commands={commands} readOnly={readOnly} />
      )}
    </>
  );
}
