import { setModuleConfig } from '@goodbot/db';
import { LFG_PROMOTE_COOLDOWN_MINUTES, UserFacingError } from '@goodbot/shared';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  DiscordAPIError,
  PermissionFlagsBits,
  RESTJSONErrorCodes,
} from 'discord.js';

import { SQUADS_TICK_MS } from './deadlines';
import { CALL_ID, MINE_ID, NOTIFY_TOGGLE_ID, SCHEDULE_ID } from './ids';
import { infoEmbed } from '../../lib/embeds';
import { childLogger } from '../../logger';

import type { AuditService } from '../audit';
import type { ConfigService } from '../config';
import type { RegistryService } from '../registry';
import type { Db } from '@goodbot/db';
import type {
  AuditSource,
  PublishedSquadMessage,
  PublishSquadGuidesResult,
  SquadsConfig,
} from '@goodbot/shared';
import type { Client, EmbedBuilder, Guild, TextChannel } from 'discord.js';

const log = childLogger('squads');

/** O corpo de uma das três mensagens: serve para postar e para reeditar. */
export interface GuideBody {
  embeds: EmbedBuilder[];
  components?: ActionRowBuilder<ButtonBuilder>[];
}

/** `#nome` clicável do canal, ou o nome do papel quando a staff ainda não escolheu. */
function channelRef(id: string | null, fallback: string): string {
  return id ? `<#${id}>` : fallback;
}

/**
 * O guia fixado do `#buscar-squad` (PRD §5.11): o canal é um chat comum, e o
 * guia diz o que o bot faz nele. Linha de cargo ou de canal que a staff não
 * configurou não aparece, para o guia nunca apontar para o nada.
 */
export function chatGuideMessage(config: SquadsConfig, embedColor?: number): GuideBody {
  const parts = [
    'Aqui é o chat de quem quer jogar. Escreva à vontade: o bot não lê nem apaga ' +
      'mensagem de ninguém.',
    '**Quer jogar agora?** Use `/procurar` e diga o quê e quantas vagas, contando você. ' +
      'Exemplo: "D10, missão de 40 min", 4 vagas. O bot abre uma sala de voz e posta um ' +
      'card aqui; quem clicar em **BORA** entra na lista e recebe o link da sala.',
  ];
  if (config.notifyRoleId) {
    parts.push(
      `**Quer ser chamado?** \`/avisos\` te dá o cargo <@&${config.notifyRoleId}>: ele é ` +
        'mencionado a cada card novo. Rodar de novo tira.',
    );
  }
  if (config.deskChannelId) {
    parts.push(
      `**Quer marcar para mais tarde?** Em <#${config.deskChannelId}> estão os botões e o ` +
        'guia da agenda.',
    );
  }
  return {
    embeds: [infoEmbed({ title: 'Buscar squad', description: parts.join('\n\n') }, embedColor)],
  };
}

/** O guia do `#jogatinas`: o papel de cada canal, os comandos e a agenda. */
export function deskGuideMessage(config: SquadsConfig, embedColor?: number): GuideBody {
  const chat = channelRef(config.chatChannelId, '**#buscar-squad**');
  const agenda = channelRef(config.agendaChannelId, '**#agenda**');
  const channels = [
    `${chat}: chat livre e os cards de quem quer jogar agora.`,
    `${channelRef(config.deskChannelId, 'Este canal')}: só o bot escreve. O guia e os ` +
      'botões logo abaixo.',
    `${agenda}: as jogatinas marcadas. Uma mensagem por jogatina, com uma thread para a ` +
      'conversa.',
  ];
  const commands = [
    '`/procurar`: jogar agora. Exemplo: "D10, missão de 40 min", 4 vagas.',
    '`/marcar`: marcar uma jogatina. Exemplo: "sex 21h", 4 vagas, nota "dificuldade 10".',
    '`/jogatinas`: as jogatinas e os cards em que você está.',
    `\`/avisos\`: liga ou desliga o cargo ${
      config.notifyRoleId ? `<@&${config.notifyRoleId}>` : 'de aviso'
    }, mencionado nos cards.`,
  ];
  const agendaHowTo =
    'A jogatina nasce **privada**: quem clica em **PEDIR VAGA** espera o seu ACEITAR, que ' +
    'chega na sua DM. Pública, quem clica em **VOU** entra na hora. Em **GERENCIAR** você ' +
    `convida gente (cada um recebe DM), divulga no ${chat} (uma vez a cada ` +
    `${String(LFG_PROMOTE_COOLDOWN_MINUTES)} min) e troca entre pública e privada. Na hora ` +
    'marcada o bot cria a sala de voz; na privada, só entra quem vai.';
  return {
    embeds: [
      infoEmbed(
        {
          title: 'Como funciona',
          fields: [
            { name: 'Os canais', value: channels.map((line) => `- ${line}`).join('\n') },
            { name: 'Os comandos', value: commands.map((line) => `- ${line}`).join('\n') },
            { name: 'A jogatina marcada', value: agendaHowTo },
          ],
        },
        embedColor,
      ),
    ],
  };
}

/** Os quatro botões do `#jogatinas`. Cada um responde só para quem clicou. */
export function deskButtonsMessage(embedColor?: number): GuideBody {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(CALL_ID)
      .setLabel('PROCURAR AGORA')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(SCHEDULE_ID)
      .setLabel('MARCAR JOGATINA')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(MINE_ID)
      .setLabel('MINHAS JOGATINAS')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(NOTIFY_TOGGLE_ID)
      .setLabel('ME AVISA')
      .setStyle(ButtonStyle.Secondary),
  );
  return {
    embeds: [
      infoEmbed(
        {
          title: 'O que você quer fazer?',
          description: 'Cada botão responde só para você, com o link do que criou.',
        },
        embedColor,
      ),
    ],
    components: [row],
  };
}

type GuideKey = keyof PublishSquadGuidesResult;
type GuideMessageField = 'chatGuideMessageId' | 'deskGuideMessageId' | 'deskButtonsMessageId';

const MESSAGE_FIELDS: Record<GuideKey, GuideMessageField> = {
  chatGuide: 'chatGuideMessageId',
  deskGuide: 'deskGuideMessageId',
  deskButtons: 'deskButtonsMessageId',
};

const GUIDE_PERMISSIONS = [
  ['Ver canal', PermissionFlagsBits.ViewChannel],
  ['Enviar mensagens', PermissionFlagsBits.SendMessages],
  ['Inserir links', PermissionFlagsBits.EmbedLinks],
] as const;

function isUnknownMessage(error: unknown): boolean {
  return error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.UnknownMessage;
}

function isMissingAccess(error: unknown): boolean {
  return (
    error instanceof DiscordAPIError &&
    (error.code === RESTJSONErrorCodes.MissingAccess ||
      error.code === RESTJSONErrorCodes.MissingPermissions)
  );
}

export interface SquadGuideDeps {
  client: Client;
  db: Db;
  config: Pick<ConfigService, 'get' | 'getSettings' | 'publishInvalidate'>;
  audit: Pick<AuditService, 'record'>;
  registry: Pick<RegistryService, 'servedGuildIds'>;
  tickMs?: number;
}

/**
 * As três mensagens do bot no módulo (PRD §5.11): o guia fixado do
 * `#buscar-squad`, e o guia e os botões do `#jogatinas`. Quem publica é
 * `/squad painel`, o painel web e o boot. A mensagem no ar é reeditada, porque
 * o texto muda com o software; a apagada é publicada de novo, mas só com
 * "Unknown Message": republicar por falha passageira deixaria duas no canal.
 *
 * O boot é um relógio, como o das salas: guild atendida em que o módulo está
 * ligado é conferida uma vez, e de novo quando a staff troca um dos canais.
 * Lá a falta de permissão só vai para o log; no `publish` ela vira erro que
 * ensina.
 */
export class SquadGuideService {
  private readonly client: Client;
  private readonly db: Db;
  private readonly config: SquadGuideDeps['config'];
  private readonly audit: Pick<AuditService, 'record'>;
  private readonly registry: Pick<RegistryService, 'servedGuildIds'>;
  private readonly tickMs: number;
  /** Guild → os canais com que ela foi conferida da última vez. */
  private readonly ensured = new Map<string, string>();
  /** Uma escrita por vez em cada guild, para boot e publish nunca postarem duas. */
  private readonly queues = new Map<string, Promise<unknown>>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(deps: SquadGuideDeps) {
    this.client = deps.client;
    this.db = deps.db;
    this.config = deps.config;
    this.audit = deps.audit;
    this.registry = deps.registry;
    this.tickMs = deps.tickMs ?? SQUADS_TICK_MS;
  }

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.tickMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private enqueue<T>(guildId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(guildId) ?? Promise.resolve();
    const next = previous.then(task, task);
    const settled = next.catch(() => undefined);
    this.queues.set(guildId, settled);
    void settled.then(() => {
      if (this.queues.get(guildId) === settled) this.queues.delete(guildId);
    });
    return next;
  }

  /** Confere as guilds em que o módulo acabou de ligar ou mudou de canal. Nunca lança. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const served = new Set(this.registry.servedGuildIds());
      for (const guildId of this.ensured.keys()) {
        if (!served.has(guildId)) this.ensured.delete(guildId);
      }
      for (const guildId of served) {
        const config = await this.config.get(guildId, 'squads');
        if (!config.enabled) {
          this.ensured.delete(guildId);
          continue;
        }
        const signature = `${String(config.chatChannelId)}:${String(config.deskChannelId)}`;
        if (this.ensured.get(guildId) === signature) continue;
        const guild = this.client.guilds.cache.get(guildId);
        if (!guild) continue;
        // Marca antes: um canal sem permissão não vira uma tentativa por minuto no log.
        this.ensured.set(guildId, signature);
        await this.ensure(guild);
      }
    } catch (error) {
      log.warn({ err: error }, 'não conferi os guias de squad');
    } finally {
      this.running = false;
    }
  }

  /** Publica o que falta e reedita o que existe, sem erro para ninguém ver: só o log. */
  ensure(guild: Guild): Promise<void> {
    return this.enqueue(guild.id, async () => {
      try {
        const config = await this.config.get(guild.id, 'squads');
        if (!config.enabled) return;
        const result = await this.sync(guild, config, null, false);
        const created = Object.entries(result)
          .filter(([, message]) => message?.created)
          .map(([key]) => key);
        if (created.length > 0)
          log.info({ guildId: guild.id, created }, 'guias de squad publicados');
      } catch (error) {
        log.warn({ err: error, guildId: guild.id }, 'guias de squad não conferidos');
      }
    });
  }

  /**
   * `/squad painel` e o botão do painel web: publica ou reedita as três. A falta
   * (módulo desligado, sem canal, sem permissão) vira erro que ensina, e é
   * conferida nos dois canais antes de escrever qualquer coisa.
   */
  publish(guild: Guild, actorId: string, source: AuditSource): Promise<PublishSquadGuidesResult> {
    return this.enqueue(guild.id, async () => {
      const config = await this.config.get(guild.id, 'squads');
      if (!config.enabled) {
        throw new UserFacingError('O módulo de squads está desligado neste servidor.', {
          code: 'MODULE_DISABLED',
        });
      }
      if (config.chatChannelId === null && config.deskChannelId === null) {
        throw new UserFacingError(
          'Escolha no painel web o canal de buscar squad e o canal de jogatinas.',
          { code: 'SQUADS_NO_GUIDE_CHANNEL' },
        );
      }
      const result = await this.sync(guild, config, actorId, true);
      this.audit.record({
        guildId: guild.id,
        action: 'squad.guides.publish',
        source,
        actor: actorId,
        after: {
          chatGuide: result.chatGuide?.messageId ?? null,
          deskGuide: result.deskGuide?.messageId ?? null,
          deskButtons: result.deskButtons?.messageId ?? null,
        },
      });
      return result;
    });
  }

  /**
   * O canal de texto com o que o bot precisa nele. `strict` lança o erro que
   * ensina; sem ele (o boot), a falta vai para o log e o canal fica de fora.
   */
  private textChannel(
    guild: Guild,
    channelId: string | null,
    what: string,
    strict: boolean,
  ): TextChannel | null {
    if (channelId === null) return null;
    const channel = guild.channels.cache.get(channelId);
    try {
      if (channel?.type !== ChannelType.GuildText) {
        throw new UserFacingError(
          `O canal ${what} não é um canal de texto. Escolha outro no painel web.`,
          {
            code: 'SQUADS_BAD_CHANNEL',
          },
        );
      }
      const me = guild.members.me;
      const permissions = me ? channel.permissionsFor(me) : null;
      const missing = GUIDE_PERMISSIONS.filter(([, flag]) => !permissions?.has(flag)).map(
        ([name]) => name,
      );
      if (missing.length > 0) {
        throw new UserFacingError(
          `Em ${channel.toString()} me falta: **${missing.join('**, **')}**.`,
          { code: 'MISSING_PERMISSIONS' },
        );
      }
      return channel;
    } catch (error) {
      if (strict) throw error;
      log.warn({ err: error, guildId: guild.id, channelId }, 'canal de guia de squad inutilizável');
      return null;
    }
  }

  private async sync(
    guild: Guild,
    config: SquadsConfig,
    actorId: string | null,
    strict: boolean,
  ): Promise<PublishSquadGuidesResult> {
    // Os dois canais conferidos antes: publicar metade e falhar na outra deixaria o
    // guia do chat apontando para um canal de jogatinas vazio.
    const chat = this.textChannel(guild, config.chatChannelId, 'de buscar squad', strict);
    const desk = this.textChannel(guild, config.deskChannelId, 'de jogatinas', strict);
    const { embedColor } = await this.config.getSettings(guild.id);
    const result: PublishSquadGuidesResult = {
      chatGuide: null,
      deskGuide: null,
      deskButtons: null,
    };

    if (chat) {
      result.chatGuide = await this.upsert(
        chat,
        config.chatGuideMessageId,
        chatGuideMessage(config, embedColor),
        true,
      );
    }
    if (desk) {
      result.deskGuide = await this.upsert(
        desk,
        config.deskGuideMessageId,
        deskGuideMessage(config, embedColor),
        false,
      );
      let buttonsId = config.deskButtonsMessageId;
      // O guia novo foi para o fim do canal: os botões tiram a mensagem antiga e
      // vão para baixo dele, que é onde a pessoa procura.
      if (result.deskGuide.created && buttonsId !== null) {
        await desk.messages.delete(buttonsId).catch(() => undefined);
        buttonsId = null;
      }
      result.deskButtons = await this.upsert(
        desk,
        buttonsId,
        deskButtonsMessage(embedColor),
        false,
      );
    }

    const changed = (Object.keys(MESSAGE_FIELDS) as GuideKey[]).filter((key) => {
      const message = result[key];
      return message !== null && message.messageId !== config[MESSAGE_FIELDS[key]];
    });
    if (changed.length > 0) {
      // O id vai para o config porque é ele que diz, depois de um restart, qual
      // mensagem editar. O resto do config segue como a staff salvou.
      const ids: Partial<Record<GuideMessageField, string>> = {};
      for (const key of changed) ids[MESSAGE_FIELDS[key]] = result[key]?.messageId;
      await setModuleConfig(this.db, guild.id, 'squads', { ...config, ...ids }, actorId);
      this.config.publishInvalidate(guild.id, 'squads');
    }
    return result;
  }

  /** Reedita a mensagem do ar ou publica uma nova (fixando, se `pin`). */
  private async upsert(
    channel: TextChannel,
    messageId: string | null,
    body: GuideBody,
    pin: boolean,
  ): Promise<PublishedSquadMessage> {
    if (messageId !== null) {
      try {
        await channel.messages.edit(messageId, body);
        return { channelId: channel.id, messageId, created: false };
      } catch (error) {
        if (!isUnknownMessage(error)) throw error;
      }
    }
    let message;
    try {
      message = await channel.send(body);
    } catch (error) {
      if (isMissingAccess(error)) {
        throw new UserFacingError(`Não tenho permissão para escrever em ${channel.toString()}.`, {
          code: 'MISSING_PERMISSIONS',
          cause: error,
        });
      }
      throw error;
    }
    if (pin) {
      try {
        await message.pin();
      } catch (error) {
        // Sem `PinMessages` a mensagem fica no ar sem pin; o resto funciona.
        log.warn(
          { err: error, guildId: channel.guildId, channelId: channel.id },
          'não fixei o guia',
        );
      }
    }
    return { channelId: channel.id, messageId: message.id, created: true };
  }
}
