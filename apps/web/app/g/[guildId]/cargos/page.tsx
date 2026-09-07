import { ScreenHeader } from '@/components/retro/screen-header';
import { ErrorState } from '@/components/retro/states';
import { hasAccess } from '@/lib/auth/access';
import { requireGuildAccess } from '@/lib/auth/require';
import { loadRoles } from '@/lib/roles';

import { RolesTable } from './roles-table';

export const metadata = { title: 'Cargos · CoBot' };

export default async function RolesPage({ params }: PageProps<'/g/[guildId]/cargos'>) {
  const { guildId } = await params;
  const session = await requireGuildAccess(guildId);
  const { roles, error } = await loadRoles(guildId);
  const readOnly = !hasAccess(session.level, 'admin');

  return (
    <>
      <ScreenHeader
        kicker="SERVIDOR"
        title="Cargos"
        meta="Cor, permissões e ordem. Só cargos abaixo do seu e abaixo do cargo do bot."
      />
      {error ? (
        <ErrorState description={error} />
      ) : (
        // `@everyone` tem o ID da guild e não é gerenciável: fica fora da lista.
        <RolesTable
          roles={roles.filter((role) => role.id !== guildId)}
          readOnly={readOnly}
        />
      )}
    </>
  );
}
