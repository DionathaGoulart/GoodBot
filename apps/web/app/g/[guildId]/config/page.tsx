import Link from 'next/link';

import { Panel } from '@/components/retro/panel';
import { ScreenHeader } from '@/components/retro/screen-header';
import { Tag } from '@/components/retro/tag';
import { requireGuildAccess } from '@/lib/auth/require';
import {
  CONFIG_GROUPS,
  CONFIG_PAGES,
  CONFIG_PAGE_KEYS,
  type ConfigGroup,
} from '@/lib/config-pages';
import { loadModulesEnabled } from '@/lib/module-config';

import type { Module } from '@goodbot/shared';

export const metadata = { title: 'Configurações · Goodbot' };

/**
 * Índice de `/config` (PRD §6.2). As onze telas de configuração numa lista
 * alfabética não dizem onde procurar: aqui elas aparecem em três blocos —
 * bot, moderação, comunidade — com a descrição de cada uma e se o módulo
 * está ligado, que é a pergunta que leva alguém a abrir a tela.
 */
export default async function ConfigIndexPage({ params }: PageProps<'/g/[guildId]/config'>) {
  const { guildId } = await params;
  await requireGuildAccess(guildId);
  const enabled = await loadModulesEnabled(guildId);

  const pagesOf = (group: ConfigGroup) =>
    CONFIG_PAGE_KEYS.filter((key) => CONFIG_PAGES[key].group === group);

  return (
    <>
      <ScreenHeader
        kicker="CONFIGURAÇÃO"
        title="Configurações"
        meta={`${CONFIG_PAGE_KEYS.length} TELAS · ${CONFIG_GROUPS.length} GRUPOS`}
      />

      {CONFIG_GROUPS.map((group) => (
        <Panel key={group.id} title={group.file}>
          <p className="screen-meta">{group.description}</p>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {pagesOf(group.id).map((key) => {
              const page = CONFIG_PAGES[key];
              const on = enabled[page.module as Module];
              return (
                <Link
                  key={key}
                  href={`/g/${guildId}/config/${key}`}
                  prefetch={false}
                  className="flex flex-col gap-2 border-2 border-base-300 bg-base-100 p-4 transition-colors hover:bg-base-200"
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="text-sm font-black uppercase tracking-wide">{page.title}</span>
                    <Tag tone={on ? 'success' : 'muted'}>{on ? 'LIGADO' : 'DESLIGADO'}</Tag>
                  </span>
                  <span className="text-sm opacity-80">{page.description}</span>
                  <span className="screen-meta">{page.file}</span>
                </Link>
              );
            })}
          </div>
        </Panel>
      ))}
    </>
  );
}
