import { and, eq, gt, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';

import { guildRegistry } from '../schema/guilds';

import type { DbExecutor } from '../client';
import type { GuildStatus } from '@goodbot/shared';

export type GuildRegistryEntry = typeof guildRegistry.$inferSelect;

/**
 * O bot atende esta guild? `approved` não tem prazo; `demo` vale até
 * `expiresAt`. A conta é feita aqui (e não só no job de expiração) porque o
 * job pode estar atrasado — e um minuto de atraso não pode virar um minuto de
 * bot atendendo de graça quem já venceu.
 *
 * `pending`, `blocked` e `expired` não são atendidos. Os três são estados
 * válidos: o bot fica calado (ou sai), não quebra.
 */
export function isGuildServed(
  entry: GuildRegistryEntry | undefined,
  now: Date = new Date(),
): boolean {
  if (!entry) return false;
  if (entry.status === 'approved') return true;
  return entry.status === 'demo' && entry.expiresAt !== null && entry.expiresAt > now;
}

export async function listGuildRegistry(
  db: DbExecutor,
  options: { status?: readonly GuildStatus[] } = {},
): Promise<GuildRegistryEntry[]> {
  const query = db.select().from(guildRegistry);
  if (options.status && options.status.length > 0) {
    return query.where(inArray(guildRegistry.status, [...options.status]));
  }
  return query;
}

export async function getGuildRegistryEntry(
  db: DbExecutor,
  guildId: string,
): Promise<GuildRegistryEntry | null> {
  const [row] = await db
    .select()
    .from(guildRegistry)
    .where(eq(guildRegistry.guildId, guildId))
    .limit(1);
  return row ?? null;
}

/** Os IDs que o bot atende agora — a lista que substituiu o `GUILD_IDS`. */
export async function listServedGuildIds(
  db: DbExecutor,
  now: Date = new Date(),
): Promise<string[]> {
  const rows = await db
    .select({ guildId: guildRegistry.guildId })
    .from(guildRegistry)
    .where(
      or(
        eq(guildRegistry.status, 'approved'),
        and(
          eq(guildRegistry.status, 'demo'),
          isNotNull(guildRegistry.expiresAt),
          // `gt` e não um `sql` cru: o template não conhece a coluna, então o
          // `Date` chega ao postgres-js como objeto. Em Node puro ele infere
          // timestamptz e serializa; no bundle do painel (Vercel/Turbopack) a
          // inferência falha e o driver tenta escrever o `Date` no protocolo:
          // `ERR_INVALID_ARG_TYPE`, 500 em toda tela logada. Pelo operador do
          // Drizzle o valor passa pelo `mapToDriverValue` da coluna e viaja
          // como texto ISO, que é o que o resto do repositório já faz.
          gt(guildRegistry.expiresAt, now),
        ),
      ),
    );
  return rows.map((row) => row.guildId);
}

/**
 * Semeia como `approved` os IDs que estavam no `GUILD_IDS`. Roda a cada boot e
 * é idempotente de propósito: `do nothing` garante que um servidor bloqueado
 * depois não volte a ser aprovado só porque o ID continua na variável.
 */
export async function seedApprovedGuilds(
  db: DbExecutor,
  guildIds: readonly string[],
): Promise<number> {
  if (guildIds.length === 0) return 0;
  const rows = await db
    .insert(guildRegistry)
    .values(
      guildIds.map((guildId) => ({
        guildId,
        status: 'approved' as const,
        approvedAt: new Date(),
        note: 'semeado a partir do GUILD_IDS',
      })),
    )
    .onConflictDoNothing({ target: guildRegistry.guildId })
    .returning({ guildId: guildRegistry.guildId });
  return rows.length;
}

/**
 * Registra a entrada do bot numa guild. Sem linha, ela nasce `pending` — quem
 * chega por fora do fluxo de convite espera aprovação como qualquer um. Com
 * linha, só o `leftAt` é limpo: o status já decidido continua valendo.
 *
 * É o caminho do `guildCreate`, que não sabe por qual link a pessoa veio. Quem
 * sabe é o callback do convite, e ele usa o `claimInvitedGuild` — que assume a
 * linha criada aqui segundos antes.
 *
 * A exceção é `expired`: a reentrada do bot **reabre** a linha como `pending`,
 * com o relógio da fila zerado. Sem isso, um reconvite cujo callback não
 * chegasse ao fim (aba fechada, painel fora do ar) deixaria o bot dentro de um
 * servidor `expired` — mudo, atendido por ninguém e fora do alcance de todo
 * job, que é exatamente o estado que a recusa por inatividade existe para
 * acabar. Estar no servidor e estar na fila passam a ser a mesma coisa.
 */
export async function ensureGuildRegistered(
  db: DbExecutor,
  input: {
    guildId: string;
    status?: GuildStatus;
    invitedBy?: string | null;
    expiresAt?: Date | null;
  },
): Promise<GuildRegistryEntry> {
  const [row] = await db
    .insert(guildRegistry)
    .values({
      guildId: input.guildId,
      status: input.status ?? 'pending',
      invitedBy: input.invitedBy ?? null,
      expiresAt: input.expiresAt ?? null,
      approvedAt: (input.status ?? 'pending') === 'approved' ? new Date() : null,
    })
    .onConflictDoUpdate({
      target: guildRegistry.guildId,
      set: {
        leftAt: null,
        status: sql`case when ${guildRegistry.status} = 'expired' then 'pending'::guild_status else ${guildRegistry.status} end`,
        invitedAt: sql`case when ${guildRegistry.status} = 'expired' then now() else ${guildRegistry.invitedAt} end`,
        note: sql`case when ${guildRegistry.status} = 'expired' then null else ${guildRegistry.note} end`,
        updatedAt: sql`now()`,
      },
    })
    .returning();
  // O `returning` de um upsert sempre devolve a linha.
  return row as GuildRegistryEntry;
}

/**
 * A escrita do fluxo de convite — e a **autoridade** sobre o status de uma
 * linha recém-criada.
 *
 * Ela existe separada do `ensureGuildRegistered` por causa de uma corrida que
 * não dá para evitar: o Discord adiciona o bot no clique em "Autorizar", então
 * o `guildCreate` chega ao gateway **antes** de o nosso callback conseguir
 * trocar o `code`. Quando o fluxo do convite vai gravar, a linha já nasceu
 * `pending`. Com a regra do `ensureGuildRegistered` ("nunca sobrescreve"), o
 * link da demonstração entregava um servidor `pending`: demo nenhuma, nunca.
 *
 * O que um convite assume, e só isto:
 *
 * · `pending` — a linha que o `guildCreate` acabou de criar;
 * · `expired` — o convite venceu na fila e a pessoa está convidando de novo;
 * · `demo` **já gasta** — o servidor testou, o bot saiu, e agora estão
 *   convidando de volta. Sem isto ele voltaria para o servidor preso num
 *   status que nenhum prazo alcança: mudo, atendido por ninguém e sem nunca
 *   entrar na fila nem na recusa por inatividade.
 *
 * O que ele nunca toca: `approved` (não volta para a fila), `blocked`
 * (continua bloqueado, use quem usar o link) e a `demo` **em curso** (clicar
 * no link normal no meio da hora não derruba o prazo que está correndo).
 *
 * E a demo não se renova: a linha só recebe prazo novo se `demo_ended_at` for
 * nulo. Quem já gastou a sua entra na fila mesmo clicando no link da demo —
 * a memória disso é o `demo_ended_at`, não o `status`.
 */
export async function claimInvitedGuild(
  db: DbExecutor,
  input: {
    guildId: string;
    status: GuildStatus;
    invitedBy?: string | null;
    expiresAt?: Date | null;
  },
): Promise<GuildRegistryEntry> {
  const invitedBy = input.invitedBy ?? null;

  /**
   * O que um convite assume. Vai no `where`, não em `case`: assim a troca é
   * atômica e duas abas clicando juntas não se atropelam.
   *
   * A demo **gasta** entra; a que ainda está correndo, não — é a diferença
   * entre "o bot já saiu e estão chamando de volta" e "clicou no link errado
   * no meio da hora".
   */
  const assumivel = or(
    inArray(guildRegistry.status, ['pending', 'expired'] as const),
    and(eq(guildRegistry.status, 'demo'), isNotNull(guildRegistry.demoEndedAt)),
  );

  /** O relógio da fila só reinicia para quem estava fora dela. Reiniciar em
   * todo clique deixaria alguém adiar a recusa para sempre pelo próprio link. */
  const invitedAt = sql`case when ${guildRegistry.status} = 'pending' then ${guildRegistry.invitedAt} else now() end`;
  /** A nota que explicava a recusa não sobrevive à volta. */
  const note = sql`case when ${guildRegistry.status} = 'pending' then ${guildRegistry.note} else null end`;

  const base = {
    ...(invitedBy ? { invitedBy } : {}),
    invitedAt,
    note,
    leftAt: null,
    updatedAt: sql`now()`,
  };

  if (input.status === 'demo') {
    // A demo só é concedida a quem nunca gastou a sua. A condição vai no
    // `where` junto com o status — uma linha só, sem ler antes de escrever.
    const [concedida] = await db
      .update(guildRegistry)
      .set({
        ...base,
        status: 'demo',
        expiresAt: input.expiresAt ?? null,
        // Um `demo_warned_at` sobrando de uma demo interrompida no meio (queda
        // do processo entre o aviso e o fim) engoliria o aviso da demo nova.
        demoWarnedAt: null,
      })
      // `demo_ended_at` nulo é a condição de "nunca gastou a sua": é ela, e
      // não o status, que impede a demo de se renovar.
      .where(
        and(eq(guildRegistry.guildId, input.guildId), assumivel, isNull(guildRegistry.demoEndedAt)),
      )
      .returning();
    if (concedida) return concedida;

    // Chegou aqui: ou a demo já foi gasta, ou o status não é assumível. A
    // primeira vira fila; a segunda não muda nada (o `where` não casa).
    const [naFila] = await db
      .update(guildRegistry)
      .set({ ...base, status: 'pending', expiresAt: null })
      .where(and(eq(guildRegistry.guildId, input.guildId), assumivel))
      .returning();
    if (naFila) return naFila;
  } else {
    const [assumida] = await db
      .update(guildRegistry)
      .set({ ...base, status: input.status, expiresAt: input.expiresAt ?? null })
      .where(and(eq(guildRegistry.guildId, input.guildId), assumivel))
      .returning();
    if (assumida) return assumida;
  }

  // Nenhum update casou: ou a linha ainda não existe (o caso raro em que o
  // callback ganhou do `guildCreate`), ou ela está num status que o convite
  // não assume. O insert resolve o primeiro; o `do nothing` protege o segundo.
  const [inserida] = await db
    .insert(guildRegistry)
    .values({
      guildId: input.guildId,
      status: input.status,
      invitedBy,
      expiresAt: input.expiresAt ?? null,
    })
    .onConflictDoNothing({ target: guildRegistry.guildId })
    .returning();
  if (inserida) return inserida;

  const atual = await getGuildRegistryEntry(db, input.guildId);
  // A linha existe (o insert conflitou); só o intervalo entre as duas queries
  // poderia tê-la apagado, e nada no produto apaga registro.
  return atual as GuildRegistryEntry;
}

export interface SetGuildStatusInput {
  status: GuildStatus;
  expiresAt?: Date | null;
  invitedBy?: string | null;
  note?: string | null;
}

/** Muda o status de um registro que já existe (aprovar, bloquear, expirar). */
export async function setGuildStatus(
  db: DbExecutor,
  guildId: string,
  input: SetGuildStatusInput,
): Promise<GuildRegistryEntry | null> {
  const [row] = await db
    .update(guildRegistry)
    .set({
      status: input.status,
      ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
      ...(input.invitedBy === undefined ? {} : { invitedBy: input.invitedBy }),
      ...(input.note === undefined ? {} : { note: input.note }),
      ...(input.status === 'approved' ? { approvedAt: new Date() } : {}),
      updatedAt: sql`now()`,
    })
    .where(eq(guildRegistry.guildId, guildId))
    .returning();
  return row ?? null;
}

/** O bot saiu (ou foi removido). O status fica: voltar não pede aprovação nova. */
export async function markGuildLeft(db: DbExecutor, guildId: string): Promise<void> {
  await db
    .update(guildRegistry)
    .set({ leftAt: sql`now()`, updatedAt: sql`now()` })
    .where(eq(guildRegistry.guildId, guildId));
}

/**
 * Demos vencidas que o job de expiração ainda não tratou.
 *
 * O `demo_ended_at` é o que fecha a varredura: o `status` continua `demo` para
 * sempre (é ele que diz "este servidor já usou a sua demo" na tela do convite
 * e na fila do painel admin), então sem esta coluna a mesma linha voltaria em
 * toda passada, para todo o sempre.
 */
export async function listExpiredDemoGuilds(
  db: DbExecutor,
  now: Date = new Date(),
): Promise<GuildRegistryEntry[]> {
  return db
    .select()
    .from(guildRegistry)
    .where(
      and(
        eq(guildRegistry.status, 'demo'),
        isNotNull(guildRegistry.expiresAt),
        lte(guildRegistry.expiresAt, now),
        isNull(guildRegistry.demoEndedAt),
      ),
    );
}

/**
 * Demos que vencem dentro de `withinMs` e ainda não receberam o aviso. Quem já
 * venceu fica de fora: para essa a passada seguinte manda a despedida, e um
 * "faltam 10 minutos" depois da hora seria mentira.
 */
export async function listDemoGuildsToWarn(
  db: DbExecutor,
  withinMs: number,
  now: Date = new Date(),
): Promise<GuildRegistryEntry[]> {
  return db
    .select()
    .from(guildRegistry)
    .where(
      and(
        eq(guildRegistry.status, 'demo'),
        isNotNull(guildRegistry.expiresAt),
        gt(guildRegistry.expiresAt, now),
        lte(guildRegistry.expiresAt, new Date(now.getTime() + withinMs)),
        isNull(guildRegistry.demoWarnedAt),
        isNull(guildRegistry.demoEndedAt),
      ),
    );
}

/** O aviso de fim de demo saiu. Marcado antes do envio (ver o job). */
export async function markDemoWarned(
  db: DbExecutor,
  guildId: string,
  at: Date = new Date(),
): Promise<void> {
  await db
    .update(guildRegistry)
    .set({ demoWarnedAt: at, updatedAt: sql`now()` })
    .where(eq(guildRegistry.guildId, guildId));
}

/** A demo foi encerrada pelo job: despedida enviada e saída feita. */
export async function markDemoEnded(
  db: DbExecutor,
  guildId: string,
  at: Date = new Date(),
): Promise<void> {
  await db
    .update(guildRegistry)
    .set({ demoEndedAt: at, updatedAt: sql`now()` })
    .where(eq(guildRegistry.guildId, guildId));
}

/**
 * Convites que passaram do prazo na fila sem decisão.
 *
 * Só `pending` entra: uma demo gasta também espera decisão, mas o bot já saiu
 * de lá — recusá-la de novo não muda nada para quem está do outro lado.
 */
export async function listPendingGuildsToExpire(
  db: DbExecutor,
  olderThan: Date,
): Promise<GuildRegistryEntry[]> {
  return db
    .select()
    .from(guildRegistry)
    .where(and(eq(guildRegistry.status, 'pending'), lte(guildRegistry.invitedAt, olderThan)));
}

/**
 * A recusa por inatividade. É o próprio `status` que fecha a varredura — uma
 * linha `expired` não volta na lista —, e é ele que deixa o convite ser
 * refeito depois (`claimInvitedGuild`).
 */
export async function markGuildExpired(
  db: DbExecutor,
  guildId: string,
  note: string,
): Promise<GuildRegistryEntry | null> {
  return setGuildStatus(db, guildId, { status: 'expired', expiresAt: null, note });
}
