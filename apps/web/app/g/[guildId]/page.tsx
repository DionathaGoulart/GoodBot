import { ScreenHeader } from '@/components/retro/screen-header';
import { StatTile } from '@/components/retro/stat-tile';
import { requireGuildAccess } from '@/lib/auth/require';

export const metadata = { title: 'Dashboard · CoBot' };

/** Placeholder: os números de verdade entram na Etapa 13. */
export default async function DashboardPage({ params }: PageProps<'/g/[guildId]'>) {
  const { guildId } = await params;
  await requireGuildAccess(guildId);

  return (
    <>
      <ScreenHeader kicker="PAINEL" title="DASHBOARD" meta="DADOS REAIS NA ETAPA 13" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="MEMBROS" value="—" hint="ÚLTIMOS 7 DIAS" />
        <StatTile label="MENSAGENS HOJE" value="—" hint="ÚLTIMAS 24H" />
        <StatTile label="CASOS 7D" value="—" hint="MODERAÇÃO" />
        <StatTile label="TICKETS ABERTOS" value="—" hint="COMUNIDADE" />
      </div>
    </>
  );
}
