import { getPanel, setPanelMessage } from '@goodbot/db';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';

import { templateToMessage } from '../lib/template';
import { childLogger } from '../logger';

import type { ConfigService } from './config';
import type { Db, PanelWithItems, ReactionRoleItem } from '@goodbot/db';
import type { ReactionRoleMode } from '@goodbot/shared';
import type { BaseMessageOptions, Client, Guild, GuildMember } from 'discord.js';

const log = childLogger('reaction-roles');

/** Motivo no audit log do Discord. */
export const REACTION_ROLE_REASON = 'Reaction role';

/** Prefixo do `custom_id`: `rr:<panelId>` (select) ou `rr:<panelId>:<itemId>`. */
export const REACTION_ROLE_PREFIX = 'rr';
/** O Discord aceita 5 botões por linha e 5 linhas por mensagem. */
export const MAX_BUTTONS_PER_ROW = 5;
export const MAX_PANEL_ITEMS = 25;

export function panelButtonId(panelId: string, itemId: string): string {
  return `${REACTION_ROLE_PREFIX}:${panelId}:${itemId}`;
}

export function panelSelectId(panelId: string): string {
  return `${REACTION_ROLE_PREFIX}:${panelId}`;
}

/** `null` quando o `custom_id` não é de reaction role. */
export function parsePanelCustomId(
  customId: string,
): { panelId: string; itemId: string | null } | null {
  const [prefix, panelId, itemId] = customId.split(':');
  if (prefix !== REACTION_ROLE_PREFIX || !panelId) return null;
  return { panelId, itemId: itemId ?? null };
}

/**
 * `name:id` é como o emoji customizado é guardado no banco; o discord.js quer
 * `<:name:id>` nos componentes. Unicode passa direto.
 */
export function toEmojiIdentifier(emoji: string): string {
  return /^\w{2,32}:\d{17,20}$/.test(emoji) ? `<:${emoji}>` : emoji;
}

/**
 * Normaliza o que o usuário digitou no comando para o formato guardado no
 * banco: `<a?:name:id>` vira `name:id`, unicode fica como está. `null` quando
 * não parece emoji nenhum.
 */
export function parseEmojiInput(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const custom = /^<a?:(\w{2,32}):(\d{17,20})>$/.exec(value);
  if (custom) return `${custom[1]}:${custom[2]}`;
  if (/^\w{2,32}:\d{17,20}$/.test(value)) return value;
  // Unicode: um emoji cabe em poucos code points; texto solto não é emoji.
  return [...value].length <= 8 && !/[\w\s]/.test(value) ? value : null;
}

// ── regra dos modos ─────────────────────────────────────────────────────────

export interface RoleChange {
  add: string[];
  remove: string[];
}

export interface ModeInput {
  mode: ReactionRoleMode;
  /** Cargos do painel — o único conjunto que o modo pode mexer. */
  panelRoleIds: readonly string[];
  /** Cargos que o membro tem agora. */
  currentRoleIds: readonly string[];
}

const NO_CHANGE: RoleChange = { add: [], remove: [] };

function others(panelRoleIds: readonly string[], keep: readonly string[]): string[] {
  return panelRoleIds.filter((id) => !keep.includes(id));
}

/**
 * Um clique (botão ou reação) sobre um cargo do painel, aplicando o modo do
 * PRD §5.5: `single` deixa só o último escolhido, `toggle` liga/desliga e
 * `multiple` só acumula. Pura — é a regra que os testes checam.
 */
export function resolveClick(input: ModeInput & { roleId: string }): RoleChange {
  const { mode, roleId, panelRoleIds, currentRoleIds } = input;
  const has = currentRoleIds.includes(roleId);

  if (mode === 'single') {
    // Trocar de cargo é o caso normal; clicar no que já se tem não remove nada
    // (para isso existe o modo `toggle`).
    const remove = others(panelRoleIds, [roleId]).filter((id) => currentRoleIds.includes(id));
    if (has && remove.length === 0) return NO_CHANGE;
    return { add: has ? [] : [roleId], remove };
  }

  if (mode === 'multiple') {
    return has ? NO_CHANGE : { add: [roleId], remove: [] };
  }

  return has ? { add: [], remove: [roleId] } : { add: [roleId], remove: [] };
}

/**
 * Uma escolha no select menu. Em `multiple` o menu só soma; nos outros modos a
 * seleção passa a ser o conjunto exato do painel (desmarcar tira o cargo).
 */
export function resolveSelect(
  input: ModeInput & { selectedRoleIds: readonly string[] },
): RoleChange {
  const { mode, selectedRoleIds, panelRoleIds, currentRoleIds } = input;
  const selected = mode === 'single' ? selectedRoleIds.slice(0, 1) : [...new Set(selectedRoleIds)];
  const valid = selected.filter((id) => panelRoleIds.includes(id));

  const add = valid.filter((id) => !currentRoleIds.includes(id));
  if (mode === 'multiple') return { add, remove: [] };

  const remove = others(panelRoleIds, valid).filter((id) => currentRoleIds.includes(id));
  return { add, remove };
}

/** Reagir dá o cargo; tirar a reação sempre tira, em qualquer modo. */
export function resolveReaction(input: ModeInput & { roleId: string; added: boolean }): RoleChange {
  if (!input.added) {
    return input.currentRoleIds.includes(input.roleId)
      ? { add: [], remove: [input.roleId] }
      : NO_CHANGE;
  }
  // Reagir de novo no mesmo emoji não deve tirar o cargo: o `toggle` de reação
  // é a própria reação, que o usuário retira.
  const mode = input.mode === 'toggle' ? 'multiple' : input.mode;
  return resolveClick({ ...input, mode });
}

// ── mensagem do painel ──────────────────────────────────────────────────────

function buttonRows(panel: PanelWithItems): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < panel.items.length; i += MAX_BUTTONS_PER_ROW) {
    const slice = panel.items.slice(i, i + MAX_BUTTONS_PER_ROW);
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        slice.map((item) => {
          const button = new ButtonBuilder()
            .setCustomId(panelButtonId(panel.id, item.id))
            .setLabel(item.label.slice(0, 80).toUpperCase())
            .setStyle(ButtonStyle.Secondary);
          if (item.emoji) button.setEmoji(toEmojiIdentifier(item.emoji));
          return button;
        }),
      ),
    );
  }
  return rows;
}

function selectRow(panel: PanelWithItems): ActionRowBuilder<StringSelectMenuBuilder>[] {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(panelSelectId(panel.id))
    .setPlaceholder('Escolha seus cargos')
    // `min 0` deixa desmarcar tudo, que é como se tira um cargo no select.
    .setMinValues(panel.mode === 'single' ? 1 : 0)
    .setMaxValues(panel.mode === 'single' ? 1 : panel.items.length)
    .addOptions(
      panel.items.map((item) => {
        const option = new StringSelectMenuOptionBuilder()
          .setValue(item.id)
          .setLabel(item.label.slice(0, 100));
        if (item.description) option.setDescription(item.description.slice(0, 100));
        if (item.emoji) option.setEmoji(toEmojiIdentifier(item.emoji));
        return option;
      }),
    );
  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)];
}

/** Corpo da mensagem do painel, sem os componentes do estilo `reactions`. */
export function panelMessage(panel: PanelWithItems, embedColor?: number): BaseMessageOptions {
  const message = templateToMessage(panel.content, {}, { embedColor });
  if (panel.items.length === 0 || panel.style === 'reactions') {
    return { ...message, components: [] };
  }
  return {
    ...message,
    components: panel.style === 'select' ? selectRow(panel) : buttonRows(panel),
  };
}

export interface ReactionRolesDeps {
  db: Db;
  client: Client;
  config: ConfigService;
}

/** Publicação e edição dos painéis de reaction role (PRD §5.5). */
export class ReactionRoleService {
  constructor(private readonly deps: ReactionRolesDeps) {}

  /** Item do painel cujo emoji bate com o da reação (`name:id` ou unicode). */
  static findItemByEmoji(panel: PanelWithItems, identifier: string): ReactionRoleItem | undefined {
    return panel.items.find((item) => item.emoji === identifier);
  }

  /**
   * Envia ou edita a mensagem do painel e guarda `message_id`. Republicar num
   * canal diferente cria mensagem nova; a antiga é removida quando dá.
   */
  async publishPanel(guild: Guild, panelId: string, channelId?: string): Promise<PanelWithItems> {
    const panel = await getPanel(this.deps.db, guild.id, panelId);
    if (!panel) throw new Error(`painel ${panelId} não existe`);

    const targetId = channelId ?? panel.channelId;
    const channel = await guild.channels.fetch(targetId).catch(() => null);
    if (!channel?.isTextBased()) {
      throw new Error(`canal ${targetId} não serve para publicar o painel`);
    }

    const settings = await this.deps.config.getSettings(guild.id);
    const body = panelMessage(panel, settings.embedColor);

    const existing =
      panel.messageId && panel.channelId === targetId
        ? await channel.messages.fetch(panel.messageId).catch(() => null)
        : null;

    const message = existing ? await existing.edit(body) : await channel.send(body);

    if (panel.messageId && panel.messageId !== message.id && panel.channelId !== targetId) {
      const old = await guild.channels.fetch(panel.channelId).catch(() => null);
      if (old?.isTextBased()) {
        await old.messages.delete(panel.messageId).catch(() => null);
      }
    }

    if (panel.style === 'reactions') await this.syncReactions(panel, message);

    await setPanelMessage(this.deps.db, panel.id, targetId, message.id);
    return { ...panel, channelId: targetId, messageId: message.id };
  }

  /** Deixa na mensagem exatamente as reações dos itens, na ordem do painel. */
  private async syncReactions(
    panel: PanelWithItems,
    message: {
      reactions: { removeAll(): Promise<unknown> };
      react(emoji: string): Promise<unknown>;
    },
  ): Promise<void> {
    await message.reactions.removeAll().catch(() => null);
    for (const item of panel.items) {
      if (!item.emoji) continue;
      try {
        await message.react(item.emoji);
      } catch (error) {
        log.warn({ err: error, panelId: panel.id, emoji: item.emoji }, 'emoji do painel inválido');
      }
    }
  }
}

/** `true` se há algo a fazer — evita ida à API do Discord por nada. */
export function hasChange(change: RoleChange): boolean {
  return change.add.length > 0 || change.remove.length > 0;
}

/**
 * Aplica a mudança no membro. `remove` vem antes de `add` para o modo `single`
 * nunca deixar o membro com dois cargos do painel, nem por um instante.
 */
export async function applyRoleChange(
  member: GuildMember,
  change: RoleChange,
  reason = REACTION_ROLE_REASON,
): Promise<void> {
  if (change.remove.length > 0) await member.roles.remove(change.remove, reason);
  if (change.add.length > 0) await member.roles.add(change.add, reason);
}

/** Texto da confirmação efêmera (`ephemeralFeedback`). */
export function describeChange(change: RoleChange): string {
  const parts: string[] = [];
  if (change.add.length > 0) {
    parts.push(`Recebeu ${change.add.map((id) => `<@&${id}>`).join(', ')}.`);
  }
  if (change.remove.length > 0) {
    parts.push(`Perdeu ${change.remove.map((id) => `<@&${id}>`).join(', ')}.`);
  }
  return parts.length > 0 ? parts.join(' ') : 'Nada mudou nos seus cargos.';
}
