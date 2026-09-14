import {
  countSocialAccounts,
  createSocialAccount,
  deleteSocialAccount,
  getSocialAccount,
  listSocialAccounts,
} from '@goodbot/db';
import {
  MAX_SOCIAL_ACCOUNTS,
  SOCIAL_DEFAULT_TEMPLATE,
  SOCIAL_KIND_LABEL,
  SOCIAL_KINDS,
  SOCIAL_MAX_FAILURES,
  SOCIAL_PLATFORM,
  SocialAccountInputSchema,
  UserFacingError,
} from '@goodbot/shared';
import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import { defineCommand } from '../../lib/command';
import { botFooter, code, infoEmbed, successEmbed } from '../../lib/embeds';
import { buildSocialMessage, sampleSocialItem } from '../../services/social/announce';
import { mentionRolesFor } from '../../services/social/mention';
import { isSocialPaused } from '../../services/social/pause';
import { SocialProviderError } from '../../services/social/types';

import type { CommandContext } from '../../lib/command';
import type { SocialAccount } from '@goodbot/db';

/** Como uma conta aparece na lista e no autocomplete. */
function label(account: SocialAccount): string {
  return account.displayName ?? account.handle ?? account.externalId;
}

/** Nome e `@handle` na mesma linha; o `@handle` some quando não foi resolvido. */
function nameLine(account: SocialAccount): string {
  return account.handle && account.displayName
    ? `${account.displayName} · ${account.handle}`
    : label(account);
}

/**
 * O estado da conta em uma linha, igual ao da tabela do painel: ligada com a
 * hora da última passada, falhando com o contador, em pausa com a hora da
 * próxima tentativa, ou desligada (o que só uma pessoa faz).
 */
function stateLine(account: SocialAccount): string {
  if (!account.enabled) return '**Desligada** · desligada à mão';
  if (account.pausedUntil) {
    const failures = `${String(account.failureCount)} erros seguidos`;
    const retry = isSocialPaused(account.pausedUntil, Date.now())
      ? `tenta de novo <t:${String(Math.floor(account.pausedUntil.getTime() / 1000))}:R>`
      : 'tenta de novo na próxima passada';
    const reason = account.disabledReason ? ` · ${account.disabledReason.slice(0, 120)}` : '';
    return `**Em pausa** · ${failures}, ${retry}${reason}`;
  }
  if (account.failureCount > 0) {
    return `**Falhando** · ${String(account.failureCount)}/${String(SOCIAL_MAX_FAILURES)} erros seguidos`;
  }
  return account.lastCheckedAt
    ? `Ligada · checada <t:${String(Math.floor(account.lastCheckedAt.getTime() / 1000))}:R>`
    : 'Ligada · ainda não checada';
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
 * configurado, começar a observar um canal, parar e testar o anúncio.
 */
export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('social')
    .setDescription('Notificações do YouTube')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub.setName('list').setDescription('Mostra os canais observados neste servidor'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Passa a avisar quando um canal do YouTube publicar')
        .addStringOption((option) =>
          option
            .setName('canal')
            .setDescription('URL do canal, @handle ou ID (UC…)')
            .setRequired(true),
        )
        .addChannelOption((option) =>
          option.setName('destino').setDescription('Onde anunciar').setRequired(true),
        )
        .addRoleOption((option) =>
          option
            .setName('cargo')
            .setDescription('Cargo mencionado em vídeos e shorts (opcional; mais cargos pelo painel)'),
        )
        .addRoleOption((option) =>
          option
            .setName('cargo-live')
            .setDescription('Cargo mencionado em lives (opcional; mais cargos pelo painel)'),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Para de observar um canal')
        .addStringOption((option) =>
          option
            .setName('conta')
            .setDescription('Qual canal remover')
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
            .setDescription('Qual canal testar')
            .setAutocomplete(true)
            .setRequired(true),
        ),
    ),
  module: 'social',
  level: 'admin',
  cooldown: 5,
  defer: true,
  ephemeral: true,
  help: 'Avisa no Discord quando um canal do YouTube publica vídeo, short ou live.',

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
                title: 'Nenhum canal observado',
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
              title: `Canais observados (${String(accounts.length)})`,
              fields: accounts.slice(0, 25).map((account) => ({
                name: nameLine(account).slice(0, 256),
                value:
                  `<#${account.discordChannelId}> · ${account.kinds.map((k) => SOCIAL_KIND_LABEL[k]).join(', ')}\n` +
                  stateLine(account),
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
      const input = ctx.interaction.options.getString('canal', true).trim();
      const destination = ctx.interaction.options.getChannel('destino', true);
      const role = ctx.interaction.options.getRole('cargo');
      const liveRole = ctx.interaction.options.getRole('cargo-live');

      // URL, @handle ou UC…: quem traduz é o provider, que também confirma que
      // o canal existe antes de a conta ir para o banco.
      let channel;
      try {
        channel = await ctx.social.resolveChannel(input);
      } catch (error) {
        if (error instanceof SocialProviderError) {
          throw new UserFacingError(error.message, { code: 'CHANNEL_NOT_FOUND' });
        }
        throw error;
      }

      // O comando dá os três tipos e o template padrão; ajustar isso é trabalho
      // do painel, que tem preview.
      const parsed = SocialAccountInputSchema.safeParse({
        platform: SOCIAL_PLATFORM,
        externalId: channel.channelId,
        handle: channel.handle,
        displayName: channel.title,
        avatarUrl: channel.avatarUrl,
        discordChannelId: destination.id,
        kinds: [...SOCIAL_KINDS],
        template: SOCIAL_DEFAULT_TEMPLATE,
        mentionRoleIds: role ? [role.id] : [],
        liveMentionRoleIds: liveRole ? [liveRole.id] : [],
        enabled: true,
      });
      if (!parsed.success) {
        throw new UserFacingError(
          parsed.error.issues[0]?.message ?? 'Não consegui usar esse canal.',
          { code: 'INVALID_ACCOUNT' },
        );
      }

      if ((await countSocialAccounts(ctx.db, ctx.guildId)) >= MAX_SOCIAL_ACCOUNTS) {
        throw new UserFacingError(`Limite de ${String(MAX_SOCIAL_ACCOUNTS)} contas atingido.`, {
          code: 'TOO_MANY_ACCOUNTS',
        });
      }

      const account = await createSocialAccount(ctx.db, ctx.guildId, {
        platform: parsed.data.platform,
        externalId: parsed.data.externalId,
        handle: parsed.data.handle,
        displayName: parsed.data.displayName,
        avatarUrl: parsed.data.avatarUrl,
        discordChannelId: parsed.data.discordChannelId,
        kinds: parsed.data.kinds,
        template: parsed.data.template,
        mentionRoleIds: parsed.data.mentionRoleIds,
        liveMentionRoleIds: parsed.data.liveMentionRoleIds,
        enabled: parsed.data.enabled,
      });
      if (!account) {
        throw new UserFacingError('Este servidor já observa esse canal.', {
          code: 'ACCOUNT_EXISTS',
        });
      }

      // O avatar do canal como thumbnail é o que confirma, de relance, que o
      // bot resolveu o canal certo — o `UC…` sozinho não diz nada a ninguém.
      const embed = successEmbed({
        title: 'Canal adicionado',
        description:
          `${nameLine(account)} → <#${account.discordChannelId}>.\n` +
          `Anuncia ${account.kinds.map((k) => SOCIAL_KIND_LABEL[k]).join(', ')}. ` +
          'A primeira passada só marca o que já existe; a próxima publicação é que vira anúncio.',
        fields: [{ name: 'ID do canal', value: code(account.externalId), inline: false }],
        footer: botFooter(),
      });
      if (account.avatarUrl) embed.setThumbnail(account.avatarUrl);

      await ctx.interaction.editReply({ embeds: [embed] });
      return;
    }

    if (sub === 'remove') {
      const account = await requireAccount(ctx, ctx.interaction.options.getString('conta', true));
      await deleteSocialAccount(ctx.db, ctx.guildId, account.id);
      await ctx.interaction.editReply({
        embeds: [
          successEmbed({
            title: 'Canal removido',
            description: `${label(account)} não será mais observado.`,
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
        mentionRoleIds: mentionRolesFor(account, item.kind),
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
