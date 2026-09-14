import {
  claimSocialPost,
  hasSocialPost,
  listEnabledSocialAccounts,
  markSocialPostAnnounced,
  pauseSocialAccount,
  recordSocialFailure,
  releaseSocialPost,
  resetSocialFailures,
  touchSocialAccount,
} from '@goodbot/db';
import {
  MINUTE_MS,
  SECOND_MS,
  SOCIAL_ACCOUNT_DELAY_MS,
  SOCIAL_DEFAULT_POLL_SECONDS,
  SOCIAL_KIND_LABEL,
  SOCIAL_MAX_FAILURES,
} from '@goodbot/shared';

import { childLogger } from '../logger';
import { buildSocialMessage } from '../services/social/announce';
import { mentionRolesFor } from '../services/social/mention';
import { isSocialPaused, socialPauseMs } from '../services/social/pause';

import type { AlertService } from '../services/alerts';
import type { AuditService } from '../services/audit';
import type { ConfigService } from '../services/config';
import type { SocialItem, SocialProvider } from '../services/social/types';
import type { Db, SocialAccount } from '@goodbot/db';
import type { SocialConfig } from '@goodbot/shared';
import type { Client, GuildTextBasedChannel } from 'discord.js';

const log = childLogger('social');

export interface SocialJobDeps {
  db: Db;
  client: Client;
  config: ConfigService;
  provider: SocialProvider;
  alerts?: Pick<AlertService, 'emit'>;
  /** Trilha de auditoria (§6.5); ausente nos testes. */
  audit?: Pick<AuditService, 'record'>;
  /** `0` nos testes: ninguém quer esperar meio segundo por conta numa suíte. */
  accountDelayMs?: number;
  now?: () => number;
}

/**
 * Polling das contas de rede social (PRD §5.8). Um laço, um intervalo: a cada
 * passada percorre **todas** as contas ligadas em sequência, com uma pausa
 * curta entre elas. Não há intervalo por conta — com o teto de 20 contas por
 * servidor a passada inteira cabe folgada no menor intervalo, e o que precisa
 * sobreviver a um restart (falhas e pausa) está no banco.
 *
 * Três invariantes:
 *
 * · **nunca anuncia duas vezes** — a linha em `social_posts` nasce antes do
 *   envio, e a unique `(account_id, external_id)` é quem decide;
 * · **nunca derruba as outras contas** — cada conta é isolada num try/catch;
 * · **nunca fica batendo numa API morta, nem desiste dela** — a partir do
 *   décimo erro seguido a conta entra em pausa (`paused_until`), a espera dobra
 *   a cada falha até 6 h, e o primeiro sucesso a devolve sozinha. Desligar
 *   (`enabled = false`) é sempre decisão humana.
 */
export class SocialJob {
  private readonly deps: SocialJobDeps;
  private readonly now: () => number;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = true;
  /**
   * Intervalo em vigor, relido da config a cada passada. Começa no padrão para
   * a primeira passada, que acontece antes de qualquer leitura.
   */
  private intervalMs = SOCIAL_DEFAULT_POLL_SECONDS * SECOND_MS;

  constructor(deps: SocialJobDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
  }

  /**
   * Reagenda a si mesmo ao fim de cada passada com o intervalo que estiver na
   * config naquele momento: mudar o intervalo no painel vale na passada
   * seguinte, sem restart e sem o job precisar ouvir invalidação.
   */
  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    log.info('job de redes sociais iniciado');
    this.schedule();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.tick().finally(() => {
        this.schedule();
      });
    }, this.intervalMs);
    this.timer.unref();
  }

  /** Uma passada. Nunca lança: o laço não pode morrer por uma API instável. */
  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const accounts = await listEnabledSocialAccounts(this.deps.db);
      const delay = this.deps.accountDelayMs ?? SOCIAL_ACCOUNT_DELAY_MS;
      /** Uma leitura de config por guild, não uma por conta. */
      const configs = new Map<string, SocialConfig>();

      let checked = 0;
      for (const account of accounts) {
        let config = configs.get(account.guildId);
        if (!config) {
          config = await this.deps.config.get(account.guildId, 'social');
          configs.set(account.guildId, config);
          this.intervalMs = config.pollIntervalSeconds * SECOND_MS;
        }
        if (!config.enabled) {
          // Módulo desligado na guild: nem chamada de API, nem linha tocada.
          continue;
        }
        if (isSocialPaused(account.pausedUntil, this.now())) {
          // Em pausa por falhas: a espera ainda não venceu. Pular sem tocar a
          // linha mantém `last_checked_at` dizendo quando ela tentou de fato.
          continue;
        }
        if (checked > 0 && delay > 0) await sleep(delay);
        await this.check(account);
        checked += 1;
      }
      return checked;
    } catch (error) {
      log.error({ err: error }, 'falha na passada do job de redes sociais');
      return 0;
    } finally {
      this.running = false;
    }
  }

  /** Uma conta: busca, anuncia o que é novo e atualiza o estado dela. */
  private async check(account: SocialAccount): Promise<void> {
    const at = new Date(this.now());
    try {
      const items = await this.deps.provider.fetchLatest({
        id: account.id,
        platform: account.platform,
        externalId: account.externalId,
        kinds: account.kinds,
        // O provider não fala com o banco: quem sabe o que já foi anunciado é
        // o job, e é esta consulta que evita reclassificar o feed inteiro.
        isKnown: (externalId) => hasSocialPost(this.deps.db, account.id, externalId),
      });

      // A primeira passada de uma conta nova só marca o que já existe como
      // visto: sem isto o canal receberia o feed inteiro de uma vez.
      const backlog = account.lastCheckedAt === null;
      // As publicações chegam da mais nova para a mais antiga; anunciar em
      // ordem cronológica deixa o canal legível.
      for (const item of [...items].reverse()) {
        await this.announce(account, item, backlog);
      }

      await touchSocialAccount(this.deps.db, account.id, at);
      if (account.failureCount > 0 || account.pausedUntil !== null) {
        await resetSocialFailures(this.deps.db, account.id);
      }
      if (account.pausedUntil !== null) this.resumed(account);
    } catch (error) {
      await touchSocialAccount(this.deps.db, account.id, at);
      await this.fail(account, error);
    }
  }

  /**
   * Reserva a publicação e manda a mensagem. A ordem importa: a linha primeiro,
   * o envio depois. Se o bot cair no meio, o restart encontra a linha e não
   * anuncia de novo; se o envio falhar de vez, a reserva é desfeita para a
   * próxima passada tentar outra vez.
   */
  private async announce(
    account: SocialAccount,
    item: SocialItem,
    backlog: boolean,
  ): Promise<void> {
    const post = await claimSocialPost(this.deps.db, {
      guildId: account.guildId,
      accountId: account.id,
      externalId: item.externalId,
      kind: item.kind,
      url: item.url,
      title: item.title || null,
      publishedAt: item.publishedAt,
    });
    // `null` = já estava em `social_posts`. Nada a fazer, e é esse o objetivo.
    if (!post) return;
    if (backlog) return;

    try {
      const channel = await this.channel(account);
      if (!channel) {
        log.warn(
          { accountId: account.id, channelId: account.discordChannelId },
          'canal do anúncio indisponível',
        );
        await releaseSocialPost(this.deps.db, post.id);
        return;
      }

      const settings = await this.deps.config.getSettings(account.guildId);
      const message = await channel.send(
        buildSocialMessage(account.template, item, account.platform, {
          embedColor: settings.embedColor,
          mentionRoleIds: mentionRolesFor(account, item.kind),
        }),
      );
      await markSocialPostAnnounced(this.deps.db, post.id, message.id);
      log.info({ accountId: account.id, kind: item.kind }, 'publicação anunciada');
      this.deps.audit?.record({
        guildId: account.guildId,
        action: `social.announce.${account.platform}`,
        source: 'job',
        target: { type: 'channel', id: account.discordChannelId },
        reason: `${account.handle ?? account.externalId} publicou ${SOCIAL_KIND_LABEL[item.kind]}`,
        after: {
          accountId: account.id,
          handle: account.handle,
          kind: item.kind,
          url: item.url,
          title: item.title || null,
          messageId: message.id,
        },
      });
    } catch (error) {
      await releaseSocialPost(this.deps.db, post.id);
      throw error;
    }
  }

  private async channel(account: SocialAccount): Promise<GuildTextBasedChannel | null> {
    const guild = this.deps.client.guilds.cache.get(account.guildId);
    if (!guild) return null;
    const channel = await guild.channels.fetch(account.discordChannelId).catch(() => null);
    if (!channel?.isTextBased() || channel.isDMBased()) return null;
    return channel;
  }

  /** Conta a falha e, a partir do teto, põe a conta em pausa. */
  private async fail(account: SocialAccount, error: unknown): Promise<void> {
    const reason = (error instanceof Error ? error.message : String(error)).slice(0, 200);
    const updated = await recordSocialFailure(this.deps.db, account.id, reason);
    const failures = updated?.failureCount ?? account.failureCount + 1;

    log.warn(
      { accountId: account.id, failures, err: error },
      'falha ao checar conta de rede social',
    );

    const pauseMs = socialPauseMs(failures);
    // `null` do banco = a conta foi removida no meio da passada: nada a pausar.
    if (!updated || pauseMs === null) return;

    const until = new Date(this.now() + pauseMs);
    await pauseSocialAccount(this.deps.db, account.id, until);
    log.warn(
      { accountId: account.id, failures, pausedUntil: until.toISOString() },
      'conta de rede social em pausa',
    );

    // Alerta só na entrada da pausa. As dobras seguintes são o mesmo problema
    // continuando, e um alerta a cada tentativa viraria ruído no webhook.
    if (failures !== SOCIAL_MAX_FAILURES) return;
    const label = account.handle ?? account.externalId;
    this.deps.alerts?.emit({
      kind: `social:${account.id}`,
      title: 'Conta de rede social em pausa',
      description:
        `\`${label}\` falhou ${String(failures)} vezes seguidas. O bot tenta de novo em ` +
        `${String(Math.round(pauseMs / MINUTE_MS))} min e dobra a espera a cada falha, até 6 h. ` +
        'No primeiro sucesso ela volta sozinha; as outras contas seguem normalmente.',
      level: 'warning',
      fields: [{ name: 'Motivo', value: reason }],
    });
  }

  /** A conta respondeu depois de uma pausa: registra e avisa pelo mesmo webhook. */
  private resumed(account: SocialAccount): void {
    const label = account.handle ?? account.externalId;
    log.info(
      { accountId: account.id, failures: account.failureCount },
      'conta de rede social saiu da pausa',
    );
    this.deps.alerts?.emit({
      // `kind` próprio: o dedupe da pausa não pode engolir o aviso de volta.
      kind: `social:${account.id}:retomada`,
      title: 'Conta de rede social voltou',
      description: `\`${label}\` respondeu de novo depois de ${String(account.failureCount)} falhas seguidas e saiu da pausa.`,
      level: 'success',
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref();
  });
}
