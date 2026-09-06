import { redirect } from 'next/navigation';

import { defaultGuildId } from '@/lib/auth/require';

/** Single-server hoje (PRD §7.1): a raiz só empurra para a guild configurada. */
export default function Home() {
  redirect(`/g/${defaultGuildId()}`);
}
