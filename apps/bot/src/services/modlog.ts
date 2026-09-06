import { setCaseModlogMessage } from '@cobot/db';

import { caseEmbed } from '../lib/case-embed';
import { childLogger } from '../logger';

import type { LogEntry, LogQueue } from './log-queue';
import type { LogService } from './logs';
import type { Case, Db } from '@cobot/db';
import type { Client } from 'discord.js';

const log = childLogger('modlog');

/**
 * Publicação de casos no canal de mod-log. `ModerationService` e o scheduler
 * chamam só esta interface; nada aqui lança — falhar o log nunca desfaz uma
 * punição já aplicada.
 */
export interface ModlogService {
  /** Publica um caso recém-criado e guarda onde ele foi parar. */
  postCase(kase: Case): Promise<void>;
  /** Reflete uma edição de motivo na mensagem já publicada. */
  updateCase(kase: Case): Promise<void>;
  /** Ações sem caso próprio: lock/unlock, purge, anti-raid (PRD §5.4). */
  postAction(guildId: string, entry: LogEntry): Promise<void>;
}

export interface ModlogDeps {
  db: Db;
  client: Client;
  logs: LogService;
  queue: LogQueue;
}

/** Implementação real (Etapa 5). */
export function createModlogService(deps: ModlogDeps): ModlogService {
  return {
    /**
     * Vai direto pela fila com `send` (e não `push`) porque o mod-log precisa
     * do id da mensagem para poder editá-la depois; o coalescing não teria
     * como devolver esse id.
     */
    async postCase(kase) {
      try {
        const target = await deps.logs.resolve(kase.guildId, 'modlog');
        if ('skipped' in target) {
          log.debug(
            { caseNumber: kase.caseNumber, reason: target.skipped },
            'mod-log não publicado',
          );
          return;
        }
        const message = await deps.queue.send(target.channelId, { embeds: [caseEmbed(kase)] });
        if (!message) return;
        await setCaseModlogMessage(deps.db, kase.id, target.channelId, message.id);
      } catch (error) {
        log.error({ err: error, caseNumber: kase.caseNumber }, 'falha ao publicar o caso');
      }
    },

    async updateCase(kase) {
      if (!kase.modlogChannelId || !kase.modlogMessageId) return;
      try {
        const channel = await deps.client.channels.fetch(kase.modlogChannelId).catch(() => null);
        if (!channel?.isTextBased()) return;
        const message = await channel.messages.fetch(kase.modlogMessageId).catch(() => null);
        if (!message) {
          log.debug({ caseNumber: kase.caseNumber }, 'mensagem do mod-log não existe mais');
          return;
        }
        await message.edit({ embeds: [caseEmbed(kase)] });
      } catch (error) {
        log.error({ err: error, caseNumber: kase.caseNumber }, 'falha ao editar o mod-log');
      }
    },

    async postAction(guildId, entry) {
      await deps.logs.emit(guildId, 'modlog', entry);
    },
  };
}

/**
 * Mod-log inerte, para testes e para o boot antes do gateway abrir. Mantém a
 * assinatura sem falar com o Discord.
 */
export function createNoopModlogService(): ModlogService {
  return {
    postCase: () => Promise.resolve(),
    updateCase: () => Promise.resolve(),
    postAction: () => Promise.resolve(),
  };
}
