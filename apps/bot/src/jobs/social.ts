import {
  claimSocialPost,
  hasSocialPost,
  listEnabledSocialAccounts,
  markSocialPostAnnounced,
  recordSocialFailure,
  releaseSocialPost,
  resetSocialFailures,
  touchSocialAccount,
} from '@goodbot/db';
import {
  SECOND_MS,
  SOCIAL_ACCOUNT_DELAY_MS,
  SOCIAL_DEFAULT_POLL_SECONDS,
  SOCIAL_KIND_LABEL,
  SOCIAL_MAX_FAILURES,
} from '@goodbot/shared';

import { childLogger } from '../logger';
import { buildSocialMessage } from '../services/social/announce';
import { mentionRoleFor } from '../services/social/mention';

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
 * curta entre elas. Não há intervalo por conta nem backoff exponencial — com o
 * teto de 20 contas por servidor a passada inteira cabe folgada no menor
 * intervalo, e o que precisa sobreviver a um restart (o contador de falhas)
 * está no banco.
 *
 * Três invariantes:
 *
 * · **nunca anuncia duas vezes** — a linha em `social_posts` nasce antes do
 *   envio, e a unique `(account_id, external_id)` é quem decide;
 * · **nunca derruba as outras contas** — cada conta é isolada num try/catch;
 * · **nunca fica batendo numa API morta** — desativação automática no décimo
 *   erro seguido, com alerta.
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
      if (account.failureCount > 0) await resetSocialFailures(this.deps.db, account.id);
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
          mentionRoleId: mentionRoleFor(account, item.kind),
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

  /** Conta a falha e avisa quando a conta se desliga sozinha. */
  private async fail(account: SocialAccount, error: unknown): Promise<void> {
    const reason = error instanceof Error ? error.message : String(error);
    const updated = await recordSocialFailure(
      this.deps.db,
      account.id,
      SOCIAL_MAX_FAILURES,
      reason.slice(0, 200),
    );
    const failures = updated?.failureCount ?? account.failureCount + 1;

    const label = account.handle ?? account.externalId;
    log.warn(
      { accountId: account.id, failures, err: error },
      'falha ao checar conta de rede social',
    );

    if (updated && !updated.enabled) {
      log.error({ accountId: account.id, reason }, 'conta de rede social desativada');
      this.deps.alerts?.emit({
        kind: `social:${account.id}`,
        title: 'Conta de rede social desativada',
        description:
          `\`${label}\` falhou ${String(failures)} vezes seguidas e foi desligada. ` +
          'As outras contas continuam normalmente.',
        level: 'danger',
        fields: [{ name: 'Motivo', value: reason.slice(0, 200) }],
      });
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref();
  });
}
