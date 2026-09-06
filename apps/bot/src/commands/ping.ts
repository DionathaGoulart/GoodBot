import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { sql } from 'drizzle-orm';

import { defineCommand } from '../lib/command';
import { botFooter, infoEmbed } from '../lib/embeds';

/** Formata latência: `-1` (gateway ainda sem heartbeat) vira `—`. */
function ms(value: number): string {
  return value < 0 ? '—' : `${Math.round(value)} ms`;
}

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Mostra a latência do bot (gateway, REST e banco)')
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),
  module: 'utilities',
  level: 'member',
  cooldown: 5,
  defer: true,
  ephemeral: true,
  help: 'Latência do gateway, da API do Discord e do banco.',
  async execute({ interaction, client, db, settings }) {
    const restStart = performance.now();
    // `fetchReply` mede o round-trip real da API REST.
    await interaction.fetchReply();
    const rest = performance.now() - restStart;

    const dbStart = performance.now();
    await db.execute(sql`select 1`);
    const database = performance.now() - dbStart;

    const uptime = Math.floor((client.uptime ?? 0) / 1000);

    await interaction.editReply({
      embeds: [
        infoEmbed(
          {
            title: 'Pong',
            fields: [
              { name: 'Gateway', value: ms(client.ws.ping), inline: true },
              { name: 'REST', value: ms(rest), inline: true },
              { name: 'Banco', value: ms(database), inline: true },
            ],
            footer: botFooter(`UPTIME: ${uptime}s`),
          },
          settings.embedColor,
        ),
      ],
    });
  },
});
