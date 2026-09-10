import { redirect } from 'next/navigation';

import { defaultGuildId } from '@/lib/auth/require';

/**
 * `force-dynamic` é obrigatório: o destino sai do registro no banco, e
 * prerenderizar esta rota no build faria o `next build` exigir um Postgres.
 */
export const dynamic = 'force-dynamic';

/** A raiz empurra para o primeiro servidor atendido (plano, Etapa 1). */
export default async function Home() {
  redirect(`/g/${await defaultGuildId()}`);
}
