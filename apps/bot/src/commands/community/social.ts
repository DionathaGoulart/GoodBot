import {
  countSocialAccounts,
  createSocialAccount,
  deleteSocialAccount,
  getSocialAccount,
  listSocialAccounts,
} from '@cobot/db';
import {
  SOCIAL_DEFAULT_TEMPLATES,
  SOCIAL_EXTERNAL_ID,
  SOCIAL_KINDS_BY_PLATFORM,
  SOCIAL_PLATFORMS,
  SocialAccountInputSchema,
  UserFacingError,
  type SocialPlatform,
} from '@cobot/shared';
import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import { defineCommand } from '../../lib/command';
import { botFooter, code, infoEmbed, successEmbed } from '../../lib/embeds';
import {
  buildSocialMessage,
  KIND_LABEL,
  PLATFORM_LABEL,
  sampleSocialItem,
} from '../../services/social/announce';

import type { CommandContext } from '../../lib/command';
import type { SocialAccount } from '@cobot/db';

const PLATFORM_CHOICES = SOCIAL_PLATFORMS.map((platform) => ({
  name: PLATFORM_LABEL[platform],
  value: platform,
}));

/** Como uma conta aparece na lista e no autocomplete. */
function label(account: SocialAccount): string {
  const name = account.displayName ?? account.handle ?? account.externalId;
  return `${PLATFORM_LABEL[account.platform]} · ${name}`;
}

async function requireModule(ctx: CommandContext): Promise<void> {
  const config = await ctx.config.get(ctx.guildId, 'social');
  if (!config.enabled) {
    throw new UserFacingError('O módulo de redes sociais está desligado neste servidor.', {
      code: 'MODULE_DISABLED',
    });
  }
}

async function requireAccount(ctx: CommandContext, id: string): Promise<SocialAccount> {
  const account = await getSocialAccount(ctx.db, ctx.guildId, id);
  if (!account) {
    throw new UserFacingError('Essa conta não existe (ou já foi removida).', {
      code: 'ACCOUNT_NOT_FOUND',
    });
  }
  return account;
}

/**
 * `/social` (PRD §5.8). O painel é o lugar de editar template e tipos; aqui
 * ficam as quatro operações que se resolvem sem sair do Discord: ver o que está
 * configurado, começar a observar uma conta, parar e testar o anúncio.
 */
export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('social')
    .setDescription('Notificações de redes sociais')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub.setName('list').setDescription('Mostra as contas observadas neste servidor'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Passa a avisar quando uma conta publicar')
        .addStringOption((option) =>
          option
            .setName('plataforma')
            .setDescription('Onde a conta publica')
            .addChoices(...PLATFORM_CHOICES)
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('id')
            .setDescription('ID do canal (YouTube), login (Twitch), IG User ID ou @ do TikTok')
            .setRequired(true),
        )
        .addChannelOption((option) =>
          option.setName('canal').setDescription('Onde anunciar').setRequired(true),
        )
        .addRoleOption((option) =>
          option.setName('cargo').setDescription('Cargo mencionado no anúncio (opcional)'),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Para de observar uma conta')
        .addStringOption((option) =>
          option
            .setName('conta')
            .setDescription('Qual conta remover')
            .setAutocomplete(true)
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('test')
        .setDescription('Manda um anúncio de exemplo no canal configurado')
        .addStringOption((option) =>
          option
            .setName('conta')
            .setDescription('Qual conta testar')
            .setAutocomplete(true)
            .setRequired(true),
        ),
    ),
  module: 'social',
  level: 'admin',
  cooldown: 5,
  defer: true,
  ephemeral: true,
  help: 'Avisa no Discord quando uma conta publica no YouTube, Twitch, Instagram ou TikTok.',

  async autocomplete({ interaction, db, guildId }) {
    const accounts = await listSocialAccounts(db, guildId);
    const query = interaction.options.getFocused().toLowerCase();
    await interaction.respond(
      accounts
        .filter((account) => label(account).toLowerCase().includes(query))
        .slice(0, 25)
        .map((account) => ({ name: label(account).slice(0, 100), value: account.id })),
    );
  },

  async execute(ctx) {
    await requireModule(ctx);
    const sub = ctx.interaction.options.getSubcommand();

    if (sub === 'list') {
      const accounts = await listSocialAccounts(ctx.db, ctx.guildId);
      if (accounts.length === 0) {
        await ctx.interaction.editReply({
          embeds: [
            infoEmbed(
              {
                title: 'Nenhuma conta observada',
                description:
                  'Use `/social add` ou a página **Redes sociais** do painel para começar.',
                footer: botFooter(),
              },
              ctx.settings.embedColor,
            ),
          ],
        });
        return;
      }

      await ctx.interaction.editReply({
        embeds: [
          infoEmbed(
            {
              title: `Contas observadas (${String(accounts.length)})`,
              fields: accounts.slice(0, 25).map((account) => ({
                name: label(account),
                value:
                  `<#${account.discordChannelId}> · ${account.kinds.map((k) => KIND_LABEL[k]).join(', ')}\n` +
                  (account.enabled
                    ? `A cada ${String(Math.round(account.pollIntervalSeconds / 60))} min`
                    : `**Desligada** — ${account.disabledReason ?? 'desligada à mão'}`),
                inline: false,
              })),
              footer: botFooter(),
            },
            ctx.settings.embedColor,
          ),
        ],
      });
      return;
    }

    if (sub === 'add') {
      const platform = ctx.interaction.options.getString('plataforma', true) as SocialPlatform;
      const externalId = ctx.interaction.options.getString('id', true).trim();
      const channel = ctx.interaction.options.getChannel('canal', true);
      const role = ctx.interaction.options.getRole('cargo');

      const reason = ctx.social.get(platform).unavailableReason();
      if (reason) throw new UserFacingError(reason, { code: 'PLATFORM_UNAVAILABLE' });

      // O comando dá os tipos e o template padrão da plataforma; ajustar isso é
      // trabalho do painel, que tem preview.
      const parsed = SocialAccountInputSchema.safeParse({
        platform,
        externalId,
        handle: externalId,
        displayName: null,
        discordChannelId: channel.id,
        kinds: [...SOCIAL_KINDS_BY_PLATFORM[platform]],
        template: SOCIAL_DEFAULT_TEMPLATES[platform],
        mentionRoleId: role?.id ?? null,
        enabled: true,
      });
      if (!parsed.success) {
        throw new UserFacingError(
          parsed.error.issues[0]?.message ?? SOCIAL_EXTERNAL_ID[platform].message,
          { code: 'INVALID_ACCOUNT' },
        );
      }

      const { maxAccounts } = await ctx.config.get(ctx.guildId, 'social');
      if ((await countSocialAccounts(ctx.db, ctx.guildId)) >= maxAccounts) {
        throw new UserFacingError(`Limite de ${String(maxAccounts)} contas atingido.`, {
          code: 'TOO_MANY_ACCOUNTS',
        });
      }

      const account = await createSocialAccount(ctx.db, ctx.guildId, {
        platform: parsed.data.platform,
        externalId: parsed.data.externalId,
        handle: parsed.data.handle,
        displayName: parsed.data.displayName,
        discordChannelId: parsed.data.discordChannelId,
        kinds: parsed.data.kinds,
        template: parsed.data.template,
        mentionRoleId: parsed.data.mentionRoleId,
        enabled: parsed.data.enabled,
        pollIntervalSeconds: parsed.data.pollIntervalSeconds,
      });
      if (!account) {
        throw new UserFacingError('Este servidor já observa essa conta.', {
          code: 'ACCOUNT_EXISTS',
        });
      }

      await ctx.interaction.editReply({
        embeds: [
          successEmbed({
            title: 'Conta adicionada',
            description:
              `${label(account)} → <#${account.discordChannelId}>.\n` +
              'A primeira passada só marca o que já existe; o próximo post é que vira anúncio.',
            fields: [{ name: 'ID', value: code(account.id), inline: false }],
            footer: botFooter(),
          }),
        ],
      });
      return;
    }

    if (sub === 'remove') {
      const account = await requireAccount(ctx, ctx.interaction.options.getString('conta', true));
      await deleteSocialAccount(ctx.db, ctx.guildId, account.id);
      await ctx.interaction.editReply({
        embeds: [
          successEmbed({
            title: 'Conta removida',
            description: `${label(account)} não será mais observada.`,
            footer: botFooter(),
          }),
        ],
      });
      return;
    }

    const account = await requireAccount(ctx, ctx.interaction.options.getString('conta', true));
    const channel = await ctx.interaction.guild?.channels
      .fetch(account.discordChannelId)
      .catch(() => null);
    if (!channel?.isTextBased() || channel.isDMBased()) {
      throw new UserFacingError('Não consigo publicar no canal configurado dessa conta.', {
        code: 'BAD_CHANNEL',
      });
    }

    const item = sampleSocialItem(account.platform, account.kinds[0] ?? 'video');
    await channel.send(
      buildSocialMessage(account.template, item, account.platform, {
        embedColor: ctx.settings.embedColor,
        mentionRoleId: account.mentionRoleId,
      }),
    );
    await ctx.interaction.editReply({
      embeds: [
        successEmbed({
          title: 'Anúncio de teste enviado',
          description: `Confira <#${channel.id}>.`,
          footer: botFooter('SÓ VOCÊ ESTÁ VENDO ISTO'),
        }),
      ],
    });
  },
});
