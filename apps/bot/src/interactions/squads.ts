import { LFG_PROMPT_COOLDOWN_HOURS, UserFacingError } from '@goodbot/shared';
import { MessageFlags } from 'discord.js';

import { botFooter, infoEmbed } from '../lib/embeds';
import { parseSquadId } from '../services/squads/ids';

import type { BotContext } from '../lib/command';
import type { SquadDmChoice } from '../services/squads/ids';
import type { SearchState } from '../services/squads/presence';
import type { SquadsConfig } from '@goodbot/shared';
import type { ButtonInteraction, GuildMember, MessageComponentInteraction } from 'discord.js';

export const STALE_FLOW_TEXT =
  'Aquele fluxo de squad acabou. Agora é só entrar no **➕ Criar Squad** ou usar o botão ' +
  '**BUSCAR SQUAD** do painel de squads.';

export function searchToggledText(state: SearchState, config: SquadsConfig): string {
  return state === 'on'
    ? 'Pronto: você está **buscando squad**. O cargo cai sozinho quando você sai da voz, ' +
        `ou em ${String(config.searchTtlMinutes)} minutos se não entrar em nenhuma.`
    : 'Pronto: você **parou de buscar** squad.';
}

export function optOutToggledText(state: SearchState): string {
  return state === 'on'
    ? 'Pronto: não te aviso mais quando você abrir o jogo. Para buscar squad, use o botão ' +
        '**BUSCAR SQUAD** do painel ou `/squad buscar`.'
    : 'Pronto: voltei a te avisar quando você abrir o jogo.';
}

export async function squadsConfigOrFail(ctx: BotContext, guildId: string): Promise<SquadsConfig> {
  const config = await ctx.config.get(guildId, 'squads');
  if (!config.enabled) {
    throw new UserFacingError('O módulo de squads está desligado neste servidor.', {
      code: 'MODULE_DISABLED',
    });
  }
  return config;
}

/**
 * Componentes do módulo em mensagem de servidor. Todo `custom_id` com o
 * prefixo é tratado aqui, inclusive os do squad fixo que ainda estão no ar:
 * esses respondem que o fluxo acabou, em vez do "botão não vale mais" genérico.
 */
export async function handleSquadComponent(
  ctx: BotContext,
  interaction: MessageComponentInteraction,
): Promise<boolean> {
  const parsed = parseSquadId(interaction.customId);
  if (!interaction.isButton() || !parsed || parsed.kind === 'dm') {
    await interaction.reply({ content: STALE_FLOW_TEXT, flags: MessageFlags.Ephemeral });
    return true;
  }
  const guildId = interaction.guildId;
  const member = interaction.member as GuildMember | null;
  if (!guildId || !member || !('roles' in member)) {
    throw new UserFacingError('Não consegui ler seus cargos. Tente de novo.', {
      code: 'NO_MEMBER',
    });
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const config = await squadsConfigOrFail(ctx, guildId);
  const content =
    parsed.kind === 'search'
      ? searchToggledText(await ctx.squads.toggleSearch(member, config), config)
      : optOutToggledText(await ctx.squads.toggleOptOut(member, config));
  await interaction.editReply({ content });
  return true;
}

function dmResultText(choice: SquadDmChoice, guildName: string, config: SquadsConfig): string {
  switch (choice) {
    case 'search':
      return `Em **${guildName}**: ${searchToggledText('on', config)}`;
    case 'later':
      return `Beleza. Não te aviso de novo nas próximas ${String(LFG_PROMPT_COOLDOWN_HOURS)} horas.`;
    case 'optout':
      return `Em **${guildName}**: ${optOutToggledText('on')}`;
  }
}

/**
 * Os botões da DM do aviso automático. A DM não é de servidor nenhum, então
 * tudo o que o gate de `interaction.ts` confere para interação de guild é
 * conferido aqui de novo, pela guild do `custom_id`: atendida, módulo ligado e
 * a pessoa ainda membro. A resposta troca a própria DM, sem botões, para o
 * clique não poder se repetir.
 */
export async function handleSquadDmButton(
  ctx: BotContext,
  interaction: ButtonInteraction,
): Promise<boolean> {
  const parsed = parseSquadId(interaction.customId);
  if (parsed?.kind !== 'dm') return false;
  const { guildId, choice } = parsed;
  // Erro depois daqui troca o embed e deixa os botões, para tentar de novo.
  await interaction.deferUpdate();
  const guild = ctx.registry.serves(guildId) ? ctx.client.guilds.cache.get(guildId) : undefined;
  if (!guild) {
    throw new UserFacingError('Esse servidor não usa mais o bot.', { code: 'GUILD_NOT_SERVED' });
  }
  const config = await squadsConfigOrFail(ctx, guildId);

  if (choice !== 'later') {
    const member = await guild.members
      .fetch({ user: interaction.user.id, force: true })
      .catch(() => null);
    if (!member) {
      throw new UserFacingError(`Você não está mais em **${guild.name}**.`, {
        code: 'NOT_A_MEMBER',
      });
    }
    if (choice === 'search') await ctx.squads.startSearch(member, config);
    else if (config.optOutRoleId === null || !member.roles.cache.has(config.optOutRoleId)) {
      await ctx.squads.toggleOptOut(member, config);
    }
  }

  await interaction.editReply({
    embeds: [
      infoEmbed({
        title: 'Buscar squad?',
        description: dmResultText(choice, guild.name, config),
        footer: botFooter(),
      }),
    ],
    components: [],
  });
  return true;
}
