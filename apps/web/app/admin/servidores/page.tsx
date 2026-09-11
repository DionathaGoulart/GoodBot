import { Panel } from '@/components/retro/panel';
import { ScreenHeader } from '@/components/retro/screen-header';
import { ErrorState } from '@/components/retro/states';
import { requireBotOwner } from '@/lib/auth/owner';
import { loadAdminGuilds } from '@/lib/admin';

import { ServersTable } from './servers-table';

export const metadata = { title: 'Servidores · Admin · Goodbot' };

export const dynamic = 'force-dynamic';

/**
 * Listar e expulsar.
 *
 * A lista é o **registro**, não o cache do bot: um servidor que aprovamos e do
 * qual o bot foi removido precisa aparecer aqui — é exatamente o caso que
 * ninguém descobre sozinho. As linhas sem `live` são essas.
 */
export default async function AdminServidoresPage() {
  await requireBotOwner();
  const { rows, botError, orphans } = await loadAdminGuilds();

  return (
    <>
      <ScreenHeader
        kicker="ADMIN"
        title="Servidores"
        meta={`${String(rows.length)} no registro · ${String(rows.filter((row) => row.served).length)} atendidos agora`}
      />

      {botError !== null ? (
        <ErrorState
          title="BOT FORA"
          description={`${botError} A lista continua vindo do registro; o que falta é o nome, o ícone e a contagem de membros.`}
        />
      ) : null}

      {orphans.length > 0 ? (
        <Panel title="ORFAOS.SYS" tone="error">
          <p className="text-sm">
            O bot está em {orphans.length} servidor(es) que não têm linha no registro. Isso não
            deveria acontecer, porque o `guildCreate` cria a linha. Reinicie o bot: o `ready` registra
            quem faltou.
          </p>
          <ul className="flex flex-col gap-1">
            {orphans.map((guild) => (
              <li key={guild.id} className="screen-meta select-all">
                {guild.name} · {guild.id}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel title="SERVIDORES.LST">
        <ServersTable rows={rows} />
      </Panel>
    </>
  );
}
