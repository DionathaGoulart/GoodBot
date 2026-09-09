import { SECOND_MS } from '@cobot/shared';

import { memberVars, templateToMessage } from '../lib/template';
import { childLogger } from '../logger';

import type { ConfigService } from './config';
import type { MessageTemplate, TemplateVars } from '@cobot/shared';
import type {
  BaseMessageOptions,
  Guild,
  GuildMember,
  GuildTextBasedChannel,
  PartialGuildMember,
} from 'discord.js';

const log = childLogger('welcome');

/** O que mudou no impulso de um membro entre dois estados. */
export type BoostTransition = 'start' | 'end' | null;

/**
 * O Discord não manda evento de impulso: o que chega é um `guildMemberUpdate`
 * com `premiumSince` mudando de/para `null`. Puro de propósito — é a regra
 * inteira, e testá-la não deve precisar de um membro do discord.js.
 *
 * Um membro **parcial** no cache tem `premiumSince` nulo sem nunca ter mudado,
 * então a primeira atualização qualquer viraria um agradecimento falso.
 */
export function boostTransition(
  before: { premiumSince: Date | null; partial: boolean },
  after: { premiumSince: Date | null },
): BoostTransition {
  if (before.partial) return null;
  const was = before.premiumSince !== null;
  const is = after.premiumSince !== null;
  if (was === is) return null;
  return is ? 'start' : 'end';
}

/** `{boostCount}` e `{boostTier}` — só a mensagem de impulso sabe preencher. */
function boostVars(guild: Guild): TemplateVars {
  return {
    boostCount: guild.premiumSubscriptionCount ?? 0,
    boostTier: guild.premiumTier,
  };
}

/** Qual das mensagens do módulo está sendo montada. */
export type WelcomeKind = 'join' | 'leave' | 'dm' | 'boost';

export type AnyMember = GuildMember | PartialGuildMember;

export interface WelcomeDeps {
  config: ConfigService;
}

/**
 * Mensagens de entrada/saída (PRD §5.5). Nada aqui pode lançar: um template
 * quebrado ou um canal apagado não podem derrubar o `guildMemberAdd`.
 */
export class WelcomeService {
  private readonly config: ConfigService;

  constructor(deps: WelcomeDeps) {
    this.config = deps.config;
  }

  /**
   * Monta a mensagem já renderizada, ou `null` quando o módulo/parte está
   * desligada ou sem template. É o que o `/welcome test` mostra em preview.
   */
  async build(kind: WelcomeKind, member: AnyMember): Promise<BaseMessageOptions | null> {
    const [config, settings] = await Promise.all([
      this.config.get(member.guild.id, 'welcome'),
      this.config.getSettings(member.guild.id),
    ]);
    if (!config.enabled) return null;

    const part = config[kind];
    if (!part.enabled) return null;
    const template: MessageTemplate | null = part.template;
    if (!template) return null;

    return templateToMessage(
      template,
      { ...memberVars(member), ...(kind === 'boost' ? boostVars(member.guild) : {}) },
      {
        embedColor: settings.embedColor,
        user: member.user,
        guild: member.guild,
      },
    );
  }

  async onJoin(member: GuildMember): Promise<void> {
    const config = await this.config.get(member.guild.id, 'welcome');
    if (!config.enabled) return;
    if (member.user.bot && config.ignoreBots) return;

    const message = await this.build('join', member);
    if (message && config.join.channelId) {
      await this.send(member, config.join.channelId, message, config.join.deleteAfterSeconds);
    }

    if (member.user.bot) return;
    const dm = await this.build('dm', member);
    if (!dm) return;
    // DM fechada é normal e não é erro: o membro já entrou de qualquer forma.
    await member.user.send(dm).catch(() => null);
  }

  /**
   * Alguém começou a impulsionar: agradece no canal e marca a pessoa com o
   * cargo. Bot não impulsiona, então `ignoreBots` não entra aqui.
   */
  async onBoostStart(member: GuildMember): Promise<void> {
    const config = await this.config.get(member.guild.id, 'welcome');
    if (!config.enabled || !config.boost.enabled) return;

    if (config.boost.roleId) {
      await member.roles
        .add(config.boost.roleId, 'Impulsionou o servidor')
        .catch((error: unknown) => {
          log.warn(
            { err: error, guildId: member.guild.id, roleId: config.boost.roleId },
            'não deu para dar o cargo de impulso',
          );
        });
    }

    const message = await this.build('boost', member);
    if (!message || !config.boost.channelId) return;
    await this.send(member, config.boost.channelId, message, 0);
  }

  /**
   * O impulso acabou: só tira o cargo. Não há mensagem de despedida de propósito
   * — anunciar que alguém parou de pagar é constrangedor e ninguém ganha nada.
   */
  async onBoostEnd(member: GuildMember): Promise<void> {
    const config = await this.config.get(member.guild.id, 'welcome');
    if (!config.enabled || !config.boost.enabled || !config.boost.roleId) return;
    if (!member.roles.cache.has(config.boost.roleId)) return;

    await member.roles
      .remove(config.boost.roleId, 'Parou de impulsionar o servidor')
      .catch((error: unknown) => {
        log.warn(
          { err: error, guildId: member.guild.id, roleId: config.boost.roleId },
          'não deu para tirar o cargo de impulso',
        );
      });
  }

  async onLeave(member: AnyMember): Promise<void> {
    const config = await this.config.get(member.guild.id, 'welcome');
    if (!config.enabled) return;
    if (member.user.bot && config.ignoreBots) return;

    const message = await this.build('leave', member);
    if (!message || !config.leave.channelId) return;
    await this.send(member, config.leave.channelId, message, config.leave.deleteAfterSeconds);
  }

  private async send(
    member: AnyMember,
    channelId: string,
    message: BaseMessageOptions,
    deleteAfterSeconds: number,
  ): Promise<void> {
    try {
      const channel = await member.guild.channels.fetch(channelId).catch(() => null);
      if (!channel?.isTextBased() || channel.isDMBased()) {
        log.warn({ guildId: member.guild.id, channelId }, 'canal de boas-vindas indisponível');
        return;
      }
      const sent = await (channel as GuildTextBasedChannel).send(message);
      if (deleteAfterSeconds > 0) {
        // `setTimeout` basta: perder a limpeza num restart é aceitável, e o
        // scheduler não deve encher de linhas por causa de uma mensagem.
        const timer = setTimeout(() => {
          void sent.delete().catch(() => null);
        }, deleteAfterSeconds * SECOND_MS);
        timer.unref();
      }
    } catch (error) {
      log.error({ err: error, guildId: member.guild.id, channelId }, 'falha ao enviar boas-vindas');
    }
  }
}
