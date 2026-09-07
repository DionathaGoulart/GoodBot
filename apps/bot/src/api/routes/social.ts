import {
  countSocialAccounts,
  createSocialAccount,
  deleteSocialAccount,
  getSocialAccount,
  listSocialAccounts,
  updateSocialAccount,
} from '@cobot/db';
import { SocialAccountInputSchema, UserFacingError } from '@cobot/shared';
import { Hono } from 'hono';

import { childLogger } from '../../logger';
import { buildSocialMessage, sampleSocialItem } from '../../services/social/announce';
import { ApiHttpError, notFound } from '../errors';
import { validate } from '../validate';

import type { ApiDeps, ApiEnv } from '../context';
import type { SocialAccount } from '@cobot/db';
import type {
  SocialAccountInput,
  SocialAccountSummary,
  SocialOverview,
  SocialTestResult,
} from '@cobot/shared';
import type { Guild, GuildTextBasedChannel } from 'discord.js';

const log = childLogger('api');

function toSummary(row: SocialAccount): SocialAccountSummary {
  return {
    id: row.id,
    platform: row.platform,
    externalId: row.externalId,
    handle: row.handle,
    displayName: row.displayName,
    discordChannelId: row.discordChannelId,
    kinds: row.kinds,
    template: row.template,
    mentionRoleId: row.mentionRoleId,
    enabled: row.enabled,
    pollIntervalSeconds: row.pollIntervalSeconds,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    lastExternalId: row.lastExternalId,
    failureCount: row.failureCount,
    disabledReason: row.disabledReason,
    createdAt: row.createdAt.toISOString(),
  };
}

function toRow(input: SocialAccountInput) {
  return {
    platform: input.platform,
    externalId: input.externalId,
    handle: input.handle,
    displayName: input.displayName,
    discordChannelId: input.discordChannelId,
    kinds: input.kinds,
    template: input.template,
    mentionRoleId: input.mentionRoleId,
    enabled: input.enabled,
    pollIntervalSeconds: input.pollIntervalSeconds,
  };
}

/**
 * Recusa uma conta numa plataforma que este processo não consegue atender.
 * Melhor um 400 explicando o que falta do que uma conta salva que nunca
 * anunciaria nada (PRD §5.8).
 */
function assertPlatformAvailable(deps: ApiDeps, input: SocialAccountInput): void {
  const reason = deps.social.get(input.platform).unavailableReason();
  if (reason) throw new UserFacingError(reason, { code: 'PLATFORM_UNAVAILABLE' });
}

async function requireChannel(guild: Guild, channelId: string): Promise<GuildTextBasedChannel> {
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || channel.isDMBased()) {
    throw new UserFacingError('Não consigo publicar nesse canal.', { code: 'BAD_CHANNEL' });
  }
  return channel;
}

/**
 * CRUD das contas de rede social para o painel (PRD §5.7). Como toda rota
 * daqui: Bearer no roteador de `/guilds`, corpo validado pelo mesmo schema Zod
 * que o formulário usa, e o rate limit global já aplicado antes de chegar aqui.
 */
export function createSocialRoutes(deps: ApiDeps): Hono<ApiEnv> {
  return new Hono<ApiEnv>()
    .get('/', async (c) => {
      const guild = c.get('guild');
      const accounts = await listSocialAccounts(deps.db, guild.id);
      const overview: SocialOverview = {
        accounts: accounts.map(toSummary),
        platforms: deps.social.statuses(),
      };
      return c.json(overview);
    })

    .post('/', validate('json', SocialAccountInputSchema), async (c) => {
      const input = c.req.valid('json');
      const guild = c.get('guild');
      assertPlatformAvailable(deps, input);
      await requireChannel(guild, input.discordChannelId);

      const { maxAccounts } = await deps.config.get(guild.id, 'social');
      if ((await countSocialAccounts(deps.db, guild.id)) >= maxAccounts) {
        throw new UserFacingError(`Limite de ${String(maxAccounts)} contas atingido.`, {
          code: 'TOO_MANY_ACCOUNTS',
        });
      }

      const row = await createSocialAccount(deps.db, guild.id, toRow(input));
      if (!row) {
        throw new ApiHttpError(409, 'ACCOUNT_EXISTS', 'Este servidor já observa essa conta.');
      }
      log.info({ guildId: guild.id, platform: input.platform }, 'conta de rede social criada');
      return c.json(toSummary(row), 201);
    })

    .patch('/:id', validate('json', SocialAccountInputSchema), async (c) => {
      const input = c.req.valid('json');
      const guild = c.get('guild');
      assertPlatformAvailable(deps, input);
      await requireChannel(guild, input.discordChannelId);

      const row = await updateSocialAccount(deps.db, guild.id, c.req.param('id'), toRow(input));
      if (!row) throw notFound('Conta não encontrada.', 'ACCOUNT_NOT_FOUND');
      return c.json(toSummary(row));
    })

    .delete('/:id', async (c) => {
      const guild = c.get('guild');
      const row = await deleteSocialAccount(deps.db, guild.id, c.req.param('id'));
      if (!row) throw notFound('Conta não encontrada.', 'ACCOUNT_NOT_FOUND');
      return c.json({ ok: true as const });
    })

    /**
     * Anúncio de mentira no canal da conta: é como o dono confere o template e
     * as permissões do bot sem esperar uma publicação de verdade.
     */
    .post('/:id/test', async (c) => {
      const guild = c.get('guild');
      const account = await getSocialAccount(deps.db, guild.id, c.req.param('id'));
      if (!account) throw notFound('Conta não encontrada.', 'ACCOUNT_NOT_FOUND');

      const channel = await requireChannel(guild, account.discordChannelId);
      const settings = await deps.config.getSettings(guild.id);
      const item = sampleSocialItem(account.platform, account.kinds[0] ?? 'video');
      const message = await channel.send(
        buildSocialMessage(account.template, item, account.platform, {
          embedColor: settings.embedColor,
          mentionRoleId: account.mentionRoleId,
        }),
      );

      const result: SocialTestResult = { channelId: channel.id, messageId: message.id };
      return c.json(result);
    });
}
