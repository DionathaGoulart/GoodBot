import { listPendingGuildsToExpire, markGuildExpired } from '@goodbot/db';
import { formatDuration, HOUR_MS, PENDING_EXPIRY_MS } from '@goodbot/shared';

import { noticeChannel } from '../lib/channels';
import { warningEmbed } from '../lib/embeds';
import { sendInviterDm } from '../lib/inviter-dm';
import { childLogger } from '../logger';

import type { AlertService } from '../services/alerts';
import type { Db, GuildRegistryEntry } from '@goodbot/db';
import type { Client, Guild } from 'discord.js';

const log = childLogger('pending-expiry');

/**
 * De hora em hora. O prazo é de uma semana, então o erro de até uma hora na
 * saída não muda nada para ninguém — e uma varredura por minuto de uma tabela
 * que quase nunca tem linha a tratar só gasta banco.
 */
export const PENDING_EXPIRY_INTERVAL_MS = HOUR_MS;

export interface PendingExpiryJobDeps {
  db: Db;
  client: Client;
  /** Links que os avisos citam. Ausentes (dev sem `AUTH_URL`) = aviso sem link. */
  urls?: { invite?: string | null; panel?: string | null };
  alerts?: Pick<AlertService, 'emit'>;
  intervalMs?: number;
  /** Prazo da fila. Injetável para o teste não esperar uma semana. */
  expiryMs?: number;
  now?: () => number;
}

/**
 * A recusa por inatividade: convite que passou uma semana na fila sem decisão
 * é recusado sozinho, o bot se despede e sai.
 *
 * A razão de existir é a mesma da expiração da demo: um bot mudo parado num
 * servidor é a pior versão possível. Só que aqui ele é mudo desde o primeiro
 * minuto — quem convidou não tem nem como distinguir "não aprovaram ainda" de
 * "instalei errado". O prazo transforma silêncio indefinido em resposta.
 *
 * `expired` **não** é `blocked`, e essa diferença é o ponto: a linha continua
 * no registro contando a história, mas o mesmo servidor pode ser convidado de
 * novo a qualquer momento (`claimInvitedGuild`), e o relógio recomeça. O
 * próprio `status` fecha a varredura — linha `expired` não volta na lista.
 */
export class PendingExpiryJob {
  private readonly deps: PendingExpiryJobDeps;
  private readonly now: () => number;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(deps: PendingExpiryJobDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(
      () => void this.tick(),
      this.deps.intervalMs ?? PENDING_EXPIRY_INTERVAL_MS,
    );
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Uma passada. Nunca lança: banco instável não pode matar o laço. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const prazo = this.deps.expiryMs ?? PENDING_EXPIRY_MS;
      const limite = new Date(this.now() - prazo);
      for (const entry of await listPendingGuildsToExpire(this.deps.db, limite)) {
        await this.expire(entry, prazo);
      }
    } catch (error) {
      log.error({ err: error }, 'falha na passada do job de recusa por inatividade');
    } finally {
      this.running = false;
    }
  }

  /**
   * A despedida e a saída.
   *
   * Ordem: aviso no servidor → DM → sair → marcar. Marcar por último é o que
   * faz a queda do processo no meio se resolver sozinha — a passada seguinte
   * reencontra a linha, não acha mais a guild e só fecha a marca. A DM vem
   * antes da saída porque depois dela pode não haver mais servidor em comum,
   * e o Discord recusa DM de bot para quem não divide nenhum.
   */
  private async expire(entry: GuildRegistryEntry, prazo: number): Promise<void> {
    const guild = this.deps.client.guilds.cache.get(entry.guildId);

    if (guild) {
      // A primeira e única vez que o bot fala neste servidor. Falar aqui não
      // fura a regra de ficar calado: ele está saindo, e sair sem explicar é
      // exatamente o que este job existe para evitar.
      await this.announce(guild, prazo);
    }

    await sendInviterDm(this.deps.client, entry.invitedBy, {
      kind: 'expired',
      guildName: guild?.name ?? null,
      ...(this.deps.urls ? { urls: this.deps.urls } : {}),
    });

    if (guild) await this.leave(guild);

    await markGuildExpired(
      this.deps.db,
      entry.guildId,
      `recusado sozinho após ${formatDuration(prazo, { style: 'long' })} na fila`,
    );
    log.info({ guildId: entry.guildId, name: guild?.name }, 'convite recusado por inatividade');

    this.deps.alerts?.emit({
      kind: `pending-expired:${entry.guildId}`,
      title: 'Convite recusado por inatividade',
      description: `O convite de \`${guild?.name ?? entry.guildId}\` venceu na fila e o bot saiu.`,
      level: 'info',
      fields: [
        { name: 'Servidor', value: guild?.name ?? '(fora do cache)' },
        { name: 'ID', value: entry.guildId },
        ...(entry.invitedBy ? [{ name: 'Convidou', value: `<@${entry.invitedBy}>` }] : []),
      ],
    });
  }

  private async announce(guild: Guild, prazo: number): Promise<void> {
    try {
      const channel = noticeChannel(guild);
      if (!channel) {
        log.warn({ guildId: guild.id }, 'sem canal onde avisar sobre a recusa');
        return;
      }
      await channel.send({
        embeds: [
          warningEmbed({
            title: 'O Goodbot está saindo',
            description: [
              `O convite deste servidor ficou ${formatDuration(prazo, { style: 'long' })} na fila` +
                ' de aprovação sem resposta, então ele foi recusado e o bot está saindo.',
              '**Isto não é um bloqueio** e nada foi apagado: dá para convidar o Goodbot de novo' +
                ' quando quiser.',
              this.deps.urls?.invite
                ? `O link do convite: ${this.deps.urls.invite}`
                : 'Use o link do convite normal para tentar de novo.',
            ].join('\n\n'),
          }),
        ],
      });
    } catch (error) {
      log.warn({ err: error, guildId: guild.id }, 'não consegui avisar sobre a recusa');
    }
  }

  private async leave(guild: Guild): Promise<void> {
    try {
      await guild.leave();
    } catch (error) {
      // A marca acontece mesmo assim: insistir de hora em hora numa guild que
      // não deixa sair só gera ruído, e o bot já não atendia nada ali.
      log.error({ err: error, guildId: guild.id }, 'não consegui sair da guild recusada');
    }
  }
}
