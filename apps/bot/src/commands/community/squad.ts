import { SlashCommandBuilder } from 'discord.js';

import { squadsConfigOrFail } from '../../interactions/squads';
import { defineCommand } from '../../lib/command';

import type { PublishedSquadMessage, PublishSquadGuidesResult } from '@goodbot/shared';

/** Uma linha por mensagem: publicada, reeditada ou sem canal configurado. */
export function guidesText(result: PublishSquadGuidesResult): string {
  const line = (what: string, message: PublishedSquadMessage | null) =>
    message === null
      ? `- ${what}: sem canal configurado.`
      : `- ${what}: ${message.created ? 'publicado' : 'atualizado'} em <#${message.channelId}>.`;
  return [
    '**Guias do buscar squad**',
    line('Guia do chat', result.chatGuide),
    line('Guia das jogatinas', result.deskGuide),
    line('Botões', result.deskButtons),
  ].join('\n');
}

/**
 * `/squad painel`: o único comando de admin do módulo (PRD §5.11). Publica ou
 * reedita os guias e os botões, pelo mesmo caminho do painel web. O resto do
 * módulo são os comandos de topo: `/procurar`, `/marcar`, `/jogatinas` e
 * `/avisos`.
 */
export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('squad')
    .setDescription('Buscar squad (admin)')
    .addSubcommand((sub) =>
      sub.setName('painel').setDescription('Publica ou atualiza os guias do buscar squad (admin)'),
    ),
  module: 'squads',
  level: 'admin',
  defer: true,
  ephemeral: true,
  cooldown: 5,
  help: '`painel` (admin) publica ou atualiza os guias e os botões dos canais do buscar squad.',
  async execute(ctx) {
    await squadsConfigOrFail(ctx, ctx.guildId);
    const result = await ctx.squadGuides.publish(ctx.member.guild, ctx.member.id, 'command');
    await ctx.interaction.editReply({ content: guidesText(result) });
  },
});
