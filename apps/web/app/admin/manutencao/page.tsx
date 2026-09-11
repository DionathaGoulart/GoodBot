import { Panel } from '@/components/retro/panel';
import { ScreenHeader } from '@/components/retro/screen-header';
import { requireBotOwner } from '@/lib/auth/owner';
import { loadAdminGuilds, loadAdminSystem } from '@/lib/admin';

import { BroadcastForm } from './broadcast-form';
import { MaintenanceForm } from './maintenance-form';

export const metadata = { title: 'Manutenção · Admin · Goodbot' };

export const dynamic = 'force-dynamic';

/**
 * O broadcast e o re-registro varrem os servidores um a um, e as actions desta
 * página herdam o teto da rota. Com o padrão da Vercel a varredura seria
 * cortada no meio — mensagens entregues, relatório nenhum, e o dono sem saber
 * até onde ela foi. Dois minutos casa com o `SWEEP_TIMEOUT_MS` do cliente.
 */
export const maxDuration = 120;

/** Broadcast e manutenção. */
export default async function AdminManutencaoPage() {
  await requireBotOwner();
  const [{ maintenance }, { rows }] = await Promise.all([loadAdminSystem(), loadAdminGuilds()]);
  const atendidos = rows.filter((row) => row.served).length;

  return (
    <>
      <ScreenHeader
        kicker="ADMIN"
        title="Manutenção"
        meta="Aviso para todos os servidores, modo manutenção e re-registro de comandos."
      />

      <Panel title="MANUTENCAO.SYS" tone={maintenance?.enabled ? 'error' : undefined}>
        <MaintenanceForm state={maintenance} />
      </Panel>

      <Panel title="BROADCAST.MSG" tone="error">
        <p className="text-sm opacity-70">
          A mensagem vai para os {atendidos} servidores atendidos agora. É irreversível: o bot não
          apaga o que publicou. Ensaie antes: o ensaio mostra em que canal ela cairia em cada um,
          sem enviar nada.
        </p>
        <BroadcastForm />
      </Panel>
    </>
  );
}
