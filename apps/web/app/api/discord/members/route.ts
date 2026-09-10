import { GuildMemberSummarySchema } from '@goodbot/shared';
import { NextResponse } from 'next/server';

import { resolveGuildSession, verdictMessage, verdictStatus } from '@/lib/auth/require';
import { guildFromQuery } from '@/lib/auth/guild-param';
import { searchMembers } from '@/lib/members';

/**
 * Busca de membros para o `MemberPicker` (§6.4). Diferente de canais e cargos,
 * a lista não cabe num fetch só: quem filtra é o bot, no cache dele, a cada
 * termo digitado. Sem cache pelo mesmo motivo.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  const guildId = guildFromQuery(request.url);
  if (guildId === null) {
    return NextResponse.json({ error: 'Servidor não configurado.' }, { status: 404 });
  }

  const access = await resolveGuildSession(guildId);
  if ('verdict' in access) {
    return NextResponse.json(
      { error: verdictMessage(access.verdict) },
      { status: verdictStatus(access.verdict) },
    );
  }

  const query = new URL(request.url).searchParams.get('q')?.slice(0, 100) ?? '';
  const { members, error } = await searchMembers(guildId, query);
  if (error) return NextResponse.json({ error }, { status: 503 });

  // 25 basta para um popover; quem procura alguém específico digita o nome.
  return NextResponse.json(GuildMemberSummarySchema.array().parse(members).slice(0, 25));
}
