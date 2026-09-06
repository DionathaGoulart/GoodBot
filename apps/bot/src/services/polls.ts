import { closePoll, getPoll } from '@cobot/db';

import { pollMessage } from '../lib/poll-message';
import { childLogger } from '../logger';

import type { Db, Poll } from '@cobot/db';
import type { Client } from 'discord.js';

const log = childLogger('polls');

export interface PollDeps {
  db: Db;
  client: Client;
}

/**
 * Encerramento e publicação de resultado. Fica fora do comando porque três
 * caminhos precisam dele: `/poll end`, o `poll_close` do scheduler e o voto
 * que chega quando a enquete já venceu.
 */
export class PollService {
  constructor(private readonly deps: PollDeps) {}

  /** Reescreve a mensagem da enquete com o resultado e sem os botões. */
  async publishResult(poll: Poll): Promise<void> {
    if (!poll.messageId) return;
    try {
      const channel = await this.deps.client.channels.fetch(poll.channelId).catch(() => null);
      if (!channel?.isTextBased()) return;
      const message = await channel.messages.fetch(poll.messageId).catch(() => null);
      if (!message) {
        log.debug({ pollId: poll.id }, 'mensagem da enquete não existe mais');
        return;
      }
      await message.edit(pollMessage(poll, { closed: true }));
    } catch (error) {
      log.error({ err: error, pollId: poll.id }, 'falha ao publicar o resultado da enquete');
    }
  }

  /**
   * Fecha e publica. Devolve `null` quando outra chamada já fechou — o
   * scheduler e um `/poll end` podem chegar no mesmo segundo.
   */
  async close(pollId: string): Promise<Poll | null> {
    const closed = await closePoll(this.deps.db, pollId);
    if (!closed) return null;
    await this.publishResult(closed);
    return closed;
  }

  /** Garante que uma enquete vencida apareça fechada, mesmo sem o scheduler. */
  async closeIfExpired(pollId: string): Promise<Poll | null> {
    const poll = await getPoll(this.deps.db, pollId);
    if (!poll || poll.closedAt || poll.endsAt.getTime() > Date.now()) return null;
    return this.close(pollId);
  }
}
