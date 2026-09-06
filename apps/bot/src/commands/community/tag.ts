import {
  countTags,
  createTag,
  deleteTag,
  getTag,
  listTagNames,
  listTags,
  normalizeTagName,
  updateTag,
  useTag,
} from '@cobot/db';
import {
  MAX_MESSAGE_CONTENT_LENGTH,
  MessageTemplateSchema,
  UserFacingError,
} from '@cobot/shared';
import { PermissionFlagsBits, SlashCommandBuilder, time, TimestampStyles } from 'discord.js';

import { defineCommand } from '../../lib/command';
import { CooldownStore } from '../../lib/cooldown';
import { botFooter, code, infoEmbed, successEmbed } from '../../lib/embeds';
import { matchTagNames } from '../../lib/tags';
import { memberVars, templateToMessage } from '../../lib/template';
import { levelAtLeast } from '../../services/permissions';

import type { CommandContext } from '../../lib/command';
import type { TagsConfig } from '@cobot/shared';

/** Nome de tag: sem espaço, para caber num `/tag nome:`. */
const MAX_NAME_LENGTH = 32;
const NAME_RE = /^[a-z0-9_-]+$/;

/**
 * O cooldown de `/tag` vem da config da guild, não do `CommandMeta` (que é
 * estático), então é medido aqui.
 */
const tagCooldowns = new CooldownStore();

async function tagsConfig(ctx: CommandContext): Promise<TagsConfig> {
  const config = await ctx.config.get(ctx.guildId, 'tags');
  if (!config.enabled) {
    throw new UserFacingError('O módulo de tags está desligado neste servidor.', {
      code: 'MODULE_DISABLED',
    });
  }
  return config;
}

/** Mods e admins sempre podem; membros só com um dos `managerRoleIds`. */
function canManage(ctx: CommandContext, config: TagsConfig): boolean {
  if (levelAtLeast(ctx.level, 'mod')) return true;
  return config.managerRoleIds.some((id) => ctx.member.roles.cache.has(id));
}

function requireManage(ctx: CommandContext, config: TagsConfig): void {
  if (canManage(ctx, config)) return;
  throw new UserFacingError('Você não tem permissão para gerenciar tags.', { code: 'FORBIDDEN' });
}

function requireValidName(raw: string): string {
  const name = normalizeTagName(raw);
  if (name.length === 0 || name.length > MAX_NAME_LENGTH || !NAME_RE.test(name)) {
    throw new UserFacingError(
      `O nome da tag aceita só letras, números, \`-\` e \`_\` (até ${MAX_NAME_LENGTH}).`,
      { code: 'BAD_TAG_NAME' },
    );
  }
  return name;
}

/** `/tag <nome>` — o uso do dia a dia, com autocomplete. */
export const tag = defineCommand({
  data: new SlashCommandBuilder()
    .setName('tag')
    .setDescription('Envia uma tag salva')
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages)
    .addStringOption((option) =>
      option
        .setName('nome')
        .setDescription('Nome da tag')
        .setAutocomplete(true)
        .setRequired(true),
    ),
  module: 'tags',
  level: 'member',
  help: 'Envia uma tag salva pelo nome.',
  async autocomplete({ interaction, config, guildId, db }) {
    const module = await config.get(guildId, 'tags');
    if (!module.enabled) {
      await interaction.respond([]);
      return;
    }
    const names = await listTagNames(db, guildId);
    const query = interaction.options.getFocused();
    await interaction.respond(
      matchTagNames(names, query).map((name) => ({ name, value: name })),
    );
  },
  async execute(ctx) {
    const config = await tagsConfig(ctx);
    if (!config.everyoneCanUse && !canManage(ctx, config)) {
      throw new UserFacingError('Só a equipe pode usar tags neste servidor.', {
        code: 'FORBIDDEN',
      });
    }

    const remaining = tagCooldowns.hit(ctx.member.id, 'tag', config.cooldownSeconds);
    if (remaining > 0) {
      throw new UserFacingError(`Aguarde ${remaining}s antes de usar outra tag.`, {
        code: 'COOLDOWN',
      });
    }

    const name = normalizeTagName(ctx.interaction.options.getString('nome', true));
    const found = await useTag(ctx.db, ctx.guildId, name);
    if (!found) {
      throw new UserFacingError(`Não existe a tag ${code(name)}.`, { code: 'TAG_NOT_FOUND' });
    }

    await ctx.interaction.reply(
      templateToMessage(found.content, memberVars(ctx.member), {
        embedColor: ctx.settings.embedColor,
        user: ctx.member.user,
        guild: ctx.member.guild,
      }),
    );
  },
});

/** `/tags …` — gestão. Separado porque o Discord não deixa um comando ter
 * options e subcommands ao mesmo tempo, e `/tag <nome>` é do PRD §5.5. */
export const tags = defineCommand({
  data: new SlashCommandBuilder()
    .setName('tags')
    .setDescription('Gerencia as tags do servidor')
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages)
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Cria uma tag')
        .addStringOption((option) =>
          option
            .setName('nome')
            .setDescription('Nome da tag (sem espaços)')
            .setMaxLength(MAX_NAME_LENGTH)
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('conteudo')
            .setDescription('Texto enviado pela tag')
            .setMaxLength(MAX_MESSAGE_CONTENT_LENGTH)
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('edit')
        .setDescription('Troca o conteúdo de uma tag')
        .addStringOption((option) =>
          option
            .setName('nome')
            .setDescription('Nome da tag')
            .setAutocomplete(true)
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('conteudo')
            .setDescription('Novo texto')
            .setMaxLength(MAX_MESSAGE_CONTENT_LENGTH)
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('delete')
        .setDescription('Apaga uma tag')
        .addStringOption((option) =>
          option
            .setName('nome')
            .setDescription('Nome da tag')
            .setAutocomplete(true)
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('Lista as tags do servidor'))
    .addSubcommand((sub) =>
      sub
        .setName('info')
        .setDescription('Quem criou, quantos usos e quando')
        .addStringOption((option) =>
          option
            .setName('nome')
            .setDescription('Nome da tag')
            .setAutocomplete(true)
            .setRequired(true),
        ),
    ),
  module: 'tags',
  level: 'member',
  cooldown: 3,
  help: 'Cria, edita, apaga e lista tags.',
  async autocomplete({ interaction, config, guildId, db }) {
    const module = await config.get(guildId, 'tags');
    if (!module.enabled) {
      await interaction.respond([]);
      return;
    }
    const names = await listTagNames(db, guildId);
    await interaction.respond(
      matchTagNames(names, interaction.options.getFocused()).map((name) => ({
        name,
        value: name,
      })),
    );
  },
  async execute(ctx) {
    const config = await tagsConfig(ctx);
    const sub = ctx.interaction.options.getSubcommand();

    if (sub === 'list') {
      const all = await listTags(ctx.db, ctx.guildId);
      await ctx.interaction.reply({
        embeds: [
          infoEmbed(
            {
              title: 'Tags',
              description:
                all.length === 0
                  ? 'Nenhuma tag ainda. Crie a primeira com `/tags create`.'
                  : all.map((row) => `${code(row.name)} · ${row.uses} uso(s)`).join('\n'),
              footer: botFooter(`${all.length}/${config.maxTags}`),
            },
            ctx.settings.embedColor,
          ),
        ],
      });
      return;
    }

    const name = requireValidName(ctx.interaction.options.getString('nome', true));

    if (sub === 'info') {
      const found = await getTag(ctx.db, ctx.guildId, name);
      if (!found) {
        throw new UserFacingError(`Não existe a tag ${code(name)}.`, { code: 'TAG_NOT_FOUND' });
      }
      await ctx.interaction.reply({
        embeds: [
          infoEmbed(
            {
              title: `Tag ${found.name}`,
              fields: [
                { name: 'Criada por', value: `<@${found.createdBy}>`, inline: true },
                { name: 'Usos', value: String(found.uses), inline: true },
                {
                  name: 'Criada em',
                  value: time(found.createdAt, TimestampStyles.ShortDateTime),
                  inline: false,
                },
              ],
              footer: botFooter(`TAG: ${found.id}`),
            },
            ctx.settings.embedColor,
          ),
        ],
      });
      return;
    }

    requireManage(ctx, config);

    if (sub === 'delete') {
      const removed = await deleteTag(ctx.db, ctx.guildId, name);
      if (!removed) {
        throw new UserFacingError(`Não existe a tag ${code(name)}.`, { code: 'TAG_NOT_FOUND' });
      }
      await ctx.interaction.reply({
        embeds: [
          successEmbed({
            title: 'Tag apagada',
            description: `A tag ${code(removed.name)} não existe mais.`,
            footer: botFooter(),
          }),
        ],
      });
      return;
    }

    // O conteúdo vem do usuário: passa pelo mesmo schema que o painel usa.
    const content = MessageTemplateSchema.parse({
      content: ctx.interaction.options.getString('conteudo', true),
    });

    if (sub === 'edit') {
      const updated = await updateTag(ctx.db, ctx.guildId, name, content);
      if (!updated) {
        throw new UserFacingError(`Não existe a tag ${code(name)}.`, { code: 'TAG_NOT_FOUND' });
      }
      await ctx.interaction.reply({
        embeds: [
          successEmbed({
            title: 'Tag atualizada',
            description: `Use \`/tag nome:${updated.name}\` para ver.`,
            footer: botFooter(),
          }),
        ],
      });
      return;
    }

    const total = await countTags(ctx.db, ctx.guildId);
    if (total >= config.maxTags) {
      throw new UserFacingError(
        `Este servidor já tem ${total} tags (máx. ${config.maxTags}).`,
        { code: 'TAG_LIMIT' },
      );
    }

    const created = await createTag(ctx.db, {
      guildId: ctx.guildId,
      name,
      content,
      createdBy: ctx.member.id,
    });
    if (!created) {
      throw new UserFacingError(`Já existe uma tag ${code(name)}. Use \`/tags edit\`.`, {
        code: 'TAG_EXISTS',
      });
    }

    await ctx.interaction.reply({
      embeds: [
        successEmbed({
          title: 'Tag criada',
          description: `Use \`/tag nome:${created.name}\` para enviá-la.`,
          footer: botFooter(`${total + 1}/${config.maxTags}`),
        }),
      ],
    });
  },
});
