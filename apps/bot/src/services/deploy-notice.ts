import { clearDeployNotice, getDeployNotice, setDeployNotice } from '@goodbot/db';
import { DEPLOY_DOWNTIME_MINUTES, MINUTE_MS } from '@goodbot/shared';

import { noticeChannel } from '../lib/channels';
import { successEmbed, warningEmbed } from '../lib/embeds';
import { childLogger } from '../logger';

import type { ConfigService } from './config';
import type { RegistryService } from './registry';
import type { Db, DeployNoticeMessage } from '@goodbot/db';
import type { DeployNoticeResult, NoticeDeployKind } from '@goodbot/shared';
import type { Client, EmbedBuilder } from 'discord.js';

const log = childLogger('deploy-notice');

/** O que cada tipo de deploy diz a quem está no servidor. */
const NOTICE_COPY: Record<NoticeDeployKind, { title: string; body: string }> = {
  restart: {
    title: 'Manutenção: atualização rápida',
    body: 'O Goodbot vai reiniciar agora para uma atualização.',
  },
  database: {
    title: 'Manutenção: atualização do banco',
    body: 'O Goodbot vai reiniciar agora para uma atualização que também mexe no banco de dados.',
  },
  infra: {
    title: 'Manutenção: infraestrutura',
    body:
      'O Goodbot vai reiniciar agora junto com o servidor que o hospeda. Nesse intervalo o' +
      ' painel também pode não conseguir salvar alterações.',
  },
};

const unix = (ms: number) => Math.floor(ms / 1000);

/** O aviso antes de cair, com a previsão de volta em hora relativa do Discord. */
export function deployNoticeEmbed(kind: NoticeDeployKind, expectedAt: number): EmbedBuilder {
  const copy = NOTICE_COPY[kind];
  const minutes = DEPLOY_DOWNTIME_MINUTES[kind];
  return warningEmbed({
    title: copy.title,
    description: [
      copy.body,
      `**Previsão de volta:** <t:${String(unix(expectedAt))}:R> (cerca de ${String(minutes)} min).`,
      'Comandos e botões não respondem nesse intervalo. Nenhuma configuração é perdida, e esta' +
        ' mensagem muda quando o bot voltar.',
    ].join('\n\n'),
  });
}

/** "menos de 1 min", "1 min", "4 min". */
function downtimeText(ms: number): string {
  const minutes = Math.round(ms / MINUTE_MS);
  return minutes < 1 ? 'menos de 1 min' : `${String(minutes)} min`;
}

/** O mesmo aviso, depois que o bot novo subiu. */
export function deployBackEmbed(downtimeMs: number): EmbedBuilder {
  return successEmbed({
    title: 'Goodbot de volta',
    description: `A manutenção terminou e o bot já responde de novo. Ficou fora por ${downtimeText(downtimeMs)}.`,
  });
}

export interface DeployNoticeServiceOptions {
  client: Client;
  db: Db;
  registry: Pick<RegistryService, 'servedGuildIds'>;
  /** Para o canal de aviso escolhido pelo servidor; o cache já é do serviço. */
  config: Pick<ConfigService, 'getSettings'>;
  now?: () => number;
}

/**
 * O aviso de manutenção de um deploy.
 *
 * O bot **velho** publica o aviso em cada servidor atendido, logo antes de o
 * script de deploy o derrubar, e grava as mensagens em `meta`. O bot **novo**,
 * no `clientReady`, edita essas mensagens para "voltou" e apaga a chave. O
 * processo que avisa nunca é o que confirma, e por isso o estado mora no banco.
 *
 * Deploy que avisa e não chega a reiniciar (o `up` falhou antes de derrubar o
 * container) deixa o aviso de pé até o próximo boot; o aviso seguinte soma as
 * mensagens ao que estava pendente, e um boot só resolve todas.
 */
export class DeployNoticeService {
  private readonly now: () => number;

  constructor(private readonly options: DeployNoticeServiceOptions) {
    this.now = options.now ?? Date.now;
  }

  /** Publica o aviso nos servidores atendidos. Servidor que falha não trava os outros. */
  async announce(kind: NoticeDeployKind): Promise<DeployNoticeResult> {
    const { client, db, registry, config } = this.options;
    const now = this.now();
    const expectedAt = now + DEPLOY_DOWNTIME_MINUTES[kind] * MINUTE_MS;

    const messages: DeployNoticeMessage[] = [];
    let total = 0;
    for (const guildId of registry.servedGuildIds()) {
      const guild = client.guilds.cache.get(guildId);
      if (!guild) continue;
      total++;
      try {
        const settings = await config.getSettings(guildId);
        const channel = noticeChannel(guild, settings.noticeChannelId);
        if (!channel) continue;
        const message = await channel.send({ embeds: [deployNoticeEmbed(kind, expectedAt)] });
        messages.push({ guildId, channelId: channel.id, messageId: message.id });
      } catch (error) {
        log.warn({ err: error, guildId }, 'aviso de deploy não chegou');
      }
    }

    const pending = await getDeployNotice(db);
    await setDeployNotice(db, {
      kind,
      startedAt: new Date(now).toISOString(),
      expectedAt: new Date(expectedAt).toISOString(),
      messages: [...(pending?.messages ?? []), ...messages],
    });
    return {
      kind,
      expectedAt: new Date(expectedAt).toISOString(),
      total,
      delivered: messages.length,
    };
  }

  /**
   * No boot: troca os avisos pendentes por "voltou" e apaga a chave. Mensagem
   * apagada ou canal sumido não impedem as outras, e a chave sai de qualquer
   * jeito: repetir no próximo boot não conserta mensagem que não existe mais.
   * Devolve quantas editou. Nunca lança.
   */
  async resolve(): Promise<number> {
    const { client, db } = this.options;
    try {
      const pending = await getDeployNotice(db);
      if (!pending) return 0;
      const downtimeMs = Math.max(0, this.now() - Date.parse(pending.startedAt));

      let edited = 0;
      for (const item of pending.messages) {
        try {
          const channel = await client.channels.fetch(item.channelId);
          if (!channel?.isTextBased() || !('messages' in channel)) continue;
          await channel.messages.edit(item.messageId, { embeds: [deployBackEmbed(downtimeMs)] });
          edited++;
        } catch (error) {
          log.warn({ err: error, guildId: item.guildId }, 'não consegui marcar o aviso de deploy');
        }
      }
      await clearDeployNotice(db);
      log.info({ edited, total: pending.messages.length, downtimeMs }, 'aviso de deploy resolvido');
      return edited;
    } catch (error) {
      log.error({ err: error }, 'falha ao resolver o aviso de deploy');
      return 0;
    }
  }
}
