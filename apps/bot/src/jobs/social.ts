import {
  claimSocialPost,
  listDueSocialAccounts,
  markSocialPostAnnounced,
  recordSocialFailure,
  releaseSocialPost,
  resetSocialFailures,
  touchSocialAccount,
} from '@cobot/db';
import { MINUTE_MS, SECOND_MS, SOCIAL_MAX_FAILURES } from '@cobot/shared';

import { childLogger } from '../logger';
import { buildSocialMessage } from '../services/social/announce';

import type { AlertService } from '../services/alerts';
import type { ConfigService } from '../services/config';
import type { SocialProviders } from '../services/social/index';
import type { SocialItem } from '../services/social/types';
import type { Db, SocialAccount } from '@cobot/db';
import type { Client, GuildTextBasedChannel } from 'discord.js';

const log = childLogger('social');

/**
 * O laço roda de minuto em minuto e cada conta decide sozinha se já é hora —
 * é o que deixa uma conta de 5 min e outra de 1 h conviverem sem um cron por
 * conta (PRD §5.8).
 */
export const SOCIAL_INTERVAL_MS = MINUTE_MS;

/** Contas por passada. Mais que isto não cabe numa janela de um minuto. */
export const SOCIAL_BATCH_SIZE = 10;

/** Base e teto do backoff exponencial de uma conta que está falhando. */
export const SOCIAL_BACKOFF_BASE_MS = 2 * MINUTE_MS;
export const SOCIAL_BACKOFF_MAX_MS = 2 * 60 * MINUTE_MS;

/** Espalha as chamadas dentro da passada em vez de disparar todas juntas. */
export const SOCIAL_JITTER_MS = 2 * SECOND_MS;

/**
 * Quanto esperar antes de tentar de novo depois de `failures` erros seguidos:
 * 2, 4, 8, 16… minutos, com teto de 2 h. Uma API fora do ar não pode virar
 * uma chamada por minuto durante horas.
 */
export function socialBackoffMs(failures: number): number {
  if (failures <= 0) return 0;
  const exponent = Math.min(failures - 1, 20);
  return Math.min(SOCIAL_BACKOFF_BASE_MS * 2 ** exponent, SOCIAL_BACKOFF_MAX_MS);
}

export interface SocialJobDeps {
  db: Db;
  client: Client;
  config: ConfigService;
  providers: SocialProviders;
  alerts?: Pick<AlertService, 'emit'>;
  intervalMs?: number;
  batchSize?: number;
  /** `0` nos testes: ninguém quer esperar o jitter numa suíte. */
  jitterMs?: number;
  now?: () => number;
  random?: () => number;
}

/**
 * Polling das contas de rede social (PRD §5.8). Três invariantes:
 *
 * · **nunca anuncia duas vezes** — a linha em `social_posts` nasce antes do
 *   envio, e a unique `(account_id, external_id)` é quem decide;
 * · **nunca derruba as outras contas** — cada conta é isolada num try/catch;
 * · **nunca fica batendo numa API morta** — backoff exponencial e desativação
 *   automática no décimo erro seguido, com alerta.
 */
export class SocialJob {
  private readonly deps: SocialJobDeps;
  private readonly now: () => number;
  private readonly random: () => number;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  /**
   * Quando cada conta em falha pode ser tentada de novo. Vive em memória de
   * propósito: um restart limpa o backoff e tenta na hora, que é o que se quer
   * depois de um deploy; o que precisa sobreviver — o contador de falhas — está
   * no banco.
   */
  private readonly nextAttempt = new Map<string, number>();

  constructor(deps: SocialJobDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
    this.random = deps.random ?? Math.random;
  }

  start(): void {
    if (this.timer) return;
    const interval = this.deps.intervalMs ?? SOCIAL_INTERVAL_MS;
    this.timer = setInterval(() => void this.tick(), interval);
    this.timer.unref();
    log.info({ intervalMs: interval }, 'job de redes sociais iniciado');
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Uma passada. Nunca lança: o laço não pode morrer por uma API instável. */
  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const accounts = await listDueSocialAccounts(
        this.deps.db,
        new Date(this.now()),
        this.deps.batchSize ?? SOCIAL_BATCH_SIZE,
      );

      let checked = 0;
      for (const account of accounts) {
        if (!this.ready(account)) continue;
        await this.jitter();
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

  private ready(account: SocialAccount): boolean {
    const next = this.nextAttempt.get(account.id);
    return next === undefined || next <= this.now();
  }

  private async jitter(): Promise<void> {
    const max = this.deps.jitterMs ?? SOCIAL_JITTER_MS;
    if (max <= 0) return;
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, Math.floor(this.random() * max));
      timer.unref();
    });
  }

  /** Uma conta: busca, anuncia o que é novo e atualiza o estado dela. */
  private async check(account: SocialAccount): Promise<void> {
    const at = new Date(this.now());
    try {
      const config = await this.deps.config.get(account.guildId, 'social');
      if (!config.enabled) {
        // Módulo desligado: marca a passada para não voltar a cada minuto.
        await touchSocialAccount(this.deps.db, account.id, at);
        return;
      }

      const provider = this.deps.providers.get(account.platform);
      const items = await provider.fetchLatest({
        id: account.id,
        platform: account.platform,
        externalId: account.externalId,
        kinds: account.kinds,
      });

      // A primeira passada de uma conta nova só marca o que já existe como
      // visto: sem isto o canal receberia o feed inteiro de uma vez.
      const backlog = account.lastCheckedAt === null && !config.announceBacklog;
      // As publicações chegam da mais nova para a mais antiga; anunciar em
      // ordem cronológica deixa o canal legível.
      for (const item of [...items].reverse()) {
        await this.announce(account, item, backlog);
      }

      await touchSocialAccount(this.deps.db, account.id, at, items[0]?.externalId);
      this.nextAttempt.delete(account.id);
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
          mentionRoleId: account.mentionRoleId,
        }),
      );
      await markSocialPostAnnounced(this.deps.db, post.id, message.id);
      log.info(
        { accountId: account.id, platform: account.platform, kind: item.kind },
        'publicação anunciada',
      );
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

  /** Conta a falha, agenda o backoff e avisa quando a conta se desliga. */
  private async fail(account: SocialAccount, error: unknown): Promise<void> {
    const reason = error instanceof Error ? error.message : String(error);
    const updated = await recordSocialFailure(
      this.deps.db,
      account.id,
      SOCIAL_MAX_FAILURES,
      reason.slice(0, 200),
    );
    const failures = updated?.failureCount ?? account.failureCount + 1;
    this.nextAttempt.set(account.id, this.now() + socialBackoffMs(failures));

    const label = account.handle ?? account.externalId;
    log.warn(
      { accountId: account.id, platform: account.platform, failures, err: error },
      'falha ao checar conta de rede social',
    );

    if (updated && !updated.enabled) {
      this.nextAttempt.delete(account.id);
      log.error({ accountId: account.id, reason }, 'conta de rede social desativada');
      this.deps.alerts?.emit({
        kind: `social:${account.id}`,
        title: 'Conta de rede social desativada',
        description:
          `\`${account.platform}/${label}\` falhou ${String(failures)} vezes seguidas e foi ` +
          'desligada. As outras contas continuam normalmente.',
        level: 'danger',
        fields: [{ name: 'Motivo', value: reason.slice(0, 200) }],
      });
    }
  }
}
