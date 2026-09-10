import { Panel } from '@/components/retro/panel';
import { ScreenHeader } from '@/components/retro/screen-header';
import { ErrorState } from '@/components/retro/states';
import { requireBotOwner } from '@/lib/auth/owner';
import { loadAdminGuilds, queueOf } from '@/lib/admin';

import { Blocklist } from './blocklist';
import { QueueList } from './queue-list';

export const metadata = { title: 'Fila · Admin · Goodbot' };

export const dynamic = 'force-dynamic';

/**
 * Aprovar e bloquear (plano, Etapa 4, item 2).
 *
 * A fila junta duas histórias porque elas fazem a mesma pergunta: quem entrou
 * pelo convite normal e espera (`pending`), e quem entrou pela demonstração,
 * usou a hora dela e agora depende de aprovação como qualquer um (`demo` com
 * `demo_ended_at` preenchido).
 *
 * Nada nesta tela depende do bot estar no ar: aprovar e bloquear são escritas
 * no registro, e o `RegistryService` as lê a cada minuto — inclusive no boot
 * seguinte, se ele estiver caído agora. A saída do servidor é a única parte
 * que precisa do bot, e ela é a metade tolerante a falha do bloqueio.
 */
export default async function AdminFilaPage() {
  await requireBotOwner();
  const { rows, botError } = await loadAdminGuilds();

  const fila = queueOf(rows);
  const bloqueados = rows.filter((row) => row.status === 'blocked');

  return (
    <>
      <ScreenHeader
        kicker="ADMIN"
        title="Fila"
        meta={`${String(fila.length)} esperando decisão · ${String(bloqueados.length)} bloqueados`}
      />

      {botError !== null ? (
        <ErrorState
          title="BOT FORA"
          description={`${botError} Aprovar continua funcionando: é uma escrita no registro, e o bot a lê quando voltar. Bloquear também — mas a saída do servidor fica para o próximo boot dele.`}
        />
      ) : null}

      <Panel title="FILA.REQ">
        <QueueList rows={fila} />
      </Panel>

      <Panel title="BLOCKLIST.CFG">
        <Blocklist rows={bloqueados} />
      </Panel>
    </>
  );
}
