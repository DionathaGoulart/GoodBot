import {
  listDemoGuildsToWarn,
  listExpiredDemoGuilds,
  markDemoEnded,
  markDemoWarned,
} from '@goodbot/db';
import { DEMO_WARNING_BEFORE_MS, MINUTE_MS } from '@goodbot/shared';

import { noticeChannel } from '../lib/channels';
import { infoEmbed } from '../lib/embeds';
import { sendInviterDm } from '../lib/inviter-dm';
import { childLogger } from '../logger';

import type { AlertService } from '../services/alerts';
import type { Db, GuildRegistryEntry } from '@goodbot/db';
import type { Client, EmbedBuilder, Guild } from 'discord.js';

const log = childLogger('demo-expiry');

/**
 * De minuto em minuto. O intervalo não é uma folga: ele é o erro máximo do
 * aviso de 10 minutos e da hora da saída, e uma demo dura uma hora.
 */
export const DEMO_EXPIRY_INTERVAL_MS = MINUTE_MS;

export interface DemoExpiryJobDeps {
  db: Db;
  client: Client;
  /** Links que os avisos citam. Ausentes (dev sem `AUTH_URL`) = aviso sem link. */
  urls?: { invite?: string | null; panel?: string | null };
  alerts?: Pick<AlertService, 'emit'>;
  intervalMs?: number;
  warnBeforeMs?: number;
  /** Relógio injetável: o teste não pode esperar uma hora. */
  now?: () => number;
}

/**
 * O fim da demonstração: avisa faltando 10 minutos, se despede e sai quando o
 * prazo acaba.
 *
 * Os dois avisos têm públicos diferentes de propósito. O de 10 minutos vai
 * **só no privado de quem convidou**: é a pessoa que decide se pede a
 * aprovação, e encher o canal do servidor com contagem regressiva de um bot
 * que ainda está funcionando é barulho para todo mundo que não decide nada. A
 * despedida continua no servidor, porque aí o fato é público — o bot está
 * saindo, e quem viu ele moderando merece saber por quê.
 *
 * O job **não** é quem decide se o bot atende — isso é o `isGuildServed`, que
 * conta o prazo na hora. Aqui é só a parte visível: sem esta passada uma demo
 * vencida viraria um bot mudo parado no servidor, que é a pior versão de todas
 * (ninguém entende se quebrou, se foi banido ou se acabou).
 *
 * Duas marcas no registro guardam o que já foi feito, e as duas estão no banco
 * de propósito: um deploy no meio da hora não pode repetir o aviso nem a
 * despedida. O `status` continua `demo` depois do fim — é ele que diz "este
 * servidor já usou a sua" na tela do convite e na fila do painel admin.
 */
export class DemoExpiryJob {
  private readonly deps: DemoExpiryJobDeps;
  private readonly now: () => number;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(deps: DemoExpiryJobDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(
      () => void this.tick(),
      this.deps.intervalMs ?? DEMO_EXPIRY_INTERVAL_MS,
    );
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Uma passada: primeiro os avisos, depois as saídas. Nunca lança. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const at = new Date(this.now());
      const within = this.deps.warnBeforeMs ?? DEMO_WARNING_BEFORE_MS;
      for (const entry of await listDemoGuildsToWarn(this.deps.db, within, at)) {
        await this.warn(entry, at);
      }
      for (const entry of await listExpiredDemoGuilds(this.deps.db, at)) {
        await this.end(entry, at);
      }
    } catch (error) {
      // O laço não pode morrer por um banco instável: a passada seguinte
      // reencontra as mesmas linhas, porque as marcas só saem no sucesso.
      log.error({ err: error }, 'falha na passada do job de expiração da demo');
    } finally {
      this.running = false;
    }
  }

  /**
   * O aviso de que o prazo está acabando.
   *
   * A marca vem **antes** do envio de propósito: falhar depois de marcar custa
   * um aviso; falhar antes custaria um aviso por minuto até o fim da demo, num
   * servidor que não é nosso.
   */
  private async warn(entry: GuildRegistryEntry, at: Date): Promise<void> {
    const expiresAt = entry.expiresAt;
    if (!expiresAt) return;
    await markDemoWarned(this.deps.db, entry.guildId, at);

    const enviado = await sendInviterDm(this.deps.client, entry.invitedBy, {
      kind: 'demo-ending',
      guildName: this.deps.client.guilds.cache.get(entry.guildId)?.name ?? null,
      expiresAt,
      ...(this.deps.urls ? { urls: this.deps.urls } : {}),
    });
    log.info(
      { guildId: entry.guildId, userId: entry.invitedBy, enviado },
      'aviso de fim de demo tratado',
    );
  }

  /**
   * A despedida e a saída.
   *
   * A ordem é mensagem → sair → marcar. Marcar por último é o que faz a queda
   * do processo no meio se resolver sozinha: a passada seguinte reencontra a
   * linha, não acha mais a guild no cache e só fecha a marca.
   */
  private async end(entry: GuildRegistryEntry, at: Date): Promise<void> {
    const guild = this.deps.client.guilds.cache.get(entry.guildId);
    if (guild) {
      await this.announce(entry.guildId, () =>
        infoEmbed({
          title: 'Fim da demonstração',
          description: [
            'O prazo da demonstração do Goodbot acabou e ele está saindo deste servidor.' +
              ' **Nada foi apagado**: casos, tags, tickets e a configuração continuam guardados' +
              ' e voltam como estavam se o bot for aprovado.',
            this.deps.urls?.invite
              ? `Quer o Goodbot de vez? Peça a aprovação: ${this.deps.urls.invite}`
              : 'Quer o Goodbot de vez? Peça a aprovação pelo convite normal.',
          ].join('\n\n'),
        }),
      );
      await this.leave(guild);
    }

    // A DM sai depois da despedida no canal e antes da marca: quem convidou é
    // o único que recebe o link do convite normal em algum lugar que não some
    // junto com o bot.
    await sendInviterDm(this.deps.client, entry.invitedBy, {
      kind: 'demo-ended',
      guildName: guild?.name ?? null,
      ...(this.deps.urls ? { urls: this.deps.urls } : {}),
    });

    await markDemoEnded(this.deps.db, entry.guildId, at);
    log.info({ guildId: entry.guildId, name: guild?.name }, 'demonstração encerrada');
    this.deps.alerts?.emit({
      kind: `demo-expired:${entry.guildId}`,
      title: 'Demonstração encerrada',
      description: `A demo de \`${guild?.name ?? entry.guildId}\` venceu e o bot saiu.`,
      level: 'info',
      fields: [
        { name: 'Servidor', value: guild?.name ?? '(fora do cache)' },
        { name: 'ID', value: entry.guildId },
        ...(entry.invitedBy ? [{ name: 'Convidou', value: `<@${entry.invitedBy}>` }] : []),
      ],
    });
  }

  /** Manda o embed no canal de aviso. Falhar aqui nunca trava a saída. */
  private async announce(guildId: string, build: () => EmbedBuilder): Promise<boolean> {
    const guild = this.deps.client.guilds.cache.get(guildId);
    if (!guild) return false;
    try {
      const channel = noticeChannel(guild);
      if (!channel) {
        log.warn({ guildId }, 'sem canal onde avisar sobre a demo');
        return false;
      }
      await channel.send({ embeds: [build()] });
      return true;
    } catch (error) {
      log.warn({ err: error, guildId }, 'não consegui avisar sobre a demo');
      return false;
    }
  }

  private async leave(guild: Guild): Promise<void> {
    try {
      await guild.leave();
    } catch (error) {
      // O `markDemoEnded` acontece mesmo assim: insistir todo minuto numa
      // guild que não deixa sair só gera ruído. O bot já não atende ninguém
      // lá, porque o prazo é contado pelo `isGuildServed`.
      log.error({ err: error, guildId: guild.id }, 'não consegui sair da guild da demo');
    }
  }
}
