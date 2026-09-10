import {
  BroadcastInputSchema,
  LeaveGuildInputSchema,
  MaintenanceInputSchema,
  ResyncCommandsInputSchema,
} from '@goodbot/shared';
import { Hono } from 'hono';

import { noticeChannel } from '../../lib/channels';
import { infoEmbed, warningEmbed } from '../../lib/embeds';
import { errorLog } from '../../lib/error-log';
import { syncCommands } from '../../lib/registry';
import { childLogger } from '../../logger';
import { metrics } from '../../metrics';
import { forbidden, notFound } from '../errors';
import { validate } from '../validate';

import type { ApiDeps, ApiEnv } from '../context';
import type {
  AdminGuildLive,
  BroadcastResult,
  BroadcastTarget,
  ResyncCommandsResult,
} from '@goodbot/shared';
import type { EmbedBuilder, Guild } from 'discord.js';

const log = childLogger('admin');

/**
 * Quantos erros recentes a tela mostra. O anel guarda cem; a tela cabe vinte,
 * e quem precisa dos outros oitenta precisa do log da VM, não desta lista.
 */
const RECENT_ERRORS = 20;

export interface AdminRoutesOptions {
  /**
   * O dono do bot (`OWNER_DISCORD_ID`). **Ausente fecha tudo**: sem ele não há
   * contra o que conferir o `actorId`, e o padrão de um `.env` incompleto não
   * pode ser "qualquer um com o Bearer manda mensagem para servidores de
   * terceiros".
   */
  ownerId?: string;
  /** Token e application id, para o re-registro de comandos. */
  discordToken: string;
  clientId: string;
}

/**
 * Confere quem pediu.
 *
 * O Bearer prova que a chamada veio do painel; ele **não** prova quem estava
 * na frente do painel. Nas rotas de guild essa segunda pergunta é respondida
 * pelo nível do `actorId` no servidor; aqui não existe servidor — o que
 * responde é ser o dono do bot. É a segunda tranca: o painel já barra a tela,
 * e isto barra a chamada.
 */
function requireOwner(options: AdminRoutesOptions, actorId: string): void {
  if (!options.ownerId) {
    throw forbidden(
      'O painel admin está desligado: falta OWNER_DISCORD_ID no ambiente do bot.',
      'OWNER_NOT_CONFIGURED',
    );
  }
  if (actorId !== options.ownerId) {
    throw forbidden('Só o dono do bot pode usar o painel admin.', 'NOT_BOT_OWNER');
  }
}

/** O dono do servidor pelo cache; nunca vale um fetch (plano, Etapa 6). */
function ownerTagOf(guild: Guild): string | null {
  const member = guild.members.cache.get(guild.ownerId);
  if (member) return member.user.tag;
  return guild.client.users.cache.get(guild.ownerId)?.tag ?? null;
}

export function toAdminGuildLive(guild: Guild): AdminGuildLive {
  return {
    id: guild.id,
    name: guild.name,
    iconUrl: guild.iconURL({ size: 128 }),
    memberCount: guild.memberCount,
    ownerId: guild.ownerId,
    ownerTag: ownerTagOf(guild),
    joinedAt: guild.joinedAt.toISOString(),
    canAnnounce: noticeChannel(guild) !== null,
  };
}

/** Mensagem curta de um erro para o campo `error` de um resultado. */
function describe(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 200);
}

/**
 * As rotas do painel do dono (plano, Etapa 4).
 *
 * São as únicas fora de `/guilds`, e por isso não passam pelo `withGuild`: a
 * lista de servidores existe justamente para mostrar as guilds que o bot **não**
 * atende (a fila de aprovação), e um middleware que exige guild atendida
 * esconderia exatamente o que a tela precisa ver.
 */
export function createAdminRoutes(deps: ApiDeps, options: AdminRoutesOptions): Hono<ApiEnv> {
  return (
    new Hono<ApiEnv>()
      /**
       * Tudo o que o bot sabe dos servidores em que está — sem o registro.
       *
       * O status, quem convidou e o prazo da demo ficam de fora de propósito:
       * eles vêm do Postgres, que o painel lê direto. É o que mantém a fila de
       * aprovação funcionando com o bot fora do ar — aprovar é uma escrita no
       * banco, e o bot a enxerga quando voltar.
       */
      .get('/guilds', (c) => {
        const guilds = [...deps.client.guilds.cache.values()]
          .map(toAdminGuildLive)
          .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
        return c.json({ guilds, cached: guilds.length });
      })

      /**
       * Sair de um servidor. É o botão de expulsar da lista, e o que fecha o
       * bloqueio: bloquear sem sair deixaria o bot parado num servidor que
       * acabou de ser recusado.
       */
      .post('/guilds/:guildId/leave', validate('json', LeaveGuildInputSchema), async (c) => {
        const input = c.req.valid('json');
        requireOwner(options, input.actorId);

        const guildId = c.req.param('guildId');
        const guild = deps.client.guilds.cache.get(guildId);
        if (!guild) throw notFound('O bot não está neste servidor.', 'GUILD_NOT_FOUND');

        const name = guild.name;
        let announced = false;
        if (input.announce) {
          announced = await announce(guild, () =>
            warningEmbed({
              title: 'O Goodbot está saindo',
              description: [
                input.reason?.trim()
                  ? `Motivo: ${input.reason.trim()}`
                  : 'O dono do bot removeu o Goodbot deste servidor.',
                '**Nada foi apagado**: casos, tags, tickets e configuração continuam guardados' +
                  ' e voltam como estavam se o bot for convidado de novo.',
              ].join('\n\n'),
            }),
          );
        }

        // O `markGuildLeft` do registro não é feito aqui: quem faz é o
        // `guildDelete`, que dispara com a saída venha ela de onde vier.
        await guild.leave();
        log.warn({ guildId, name, by: input.actorId }, 'bot removido de uma guild pelo painel');
        return c.json({ guildId, name, announced });
      })

      /**
       * Aviso para todos os servidores atendidos.
       *
       * Sequencial de propósito: cem mensagens disparadas juntas passariam do
       * limite global do Discord, e a fila do discord.js resolveria isso
       * enfileirando — só que sem ninguém saber onde parou. Uma de cada vez
       * custa segundos e devolve a lista exata do que chegou e do que não.
       */
      .post('/broadcast', validate('json', BroadcastInputSchema), async (c) => {
        const input = c.req.valid('json');
        requireOwner(options, input.actorId);

        const targets: BroadcastTarget[] = [];
        for (const guildId of deps.registry.servedGuildIds()) {
          const guild = deps.client.guilds.cache.get(guildId);
          if (!guild) continue;

          // O `try` cobre a escolha do canal **e** o envio: um servidor que
          // falhe por qualquer motivo não pode interromper a varredura. Metade
          // de um broadcast entregue e sem relatório é o pior resultado
          // possível — ninguém saberia até onde ele foi.
          try {
            const channel = noticeChannel(guild);
            const base = {
              guildId,
              name: guild.name,
              channelId: channel?.id ?? null,
              channelName: channel?.name ?? null,
            };

            if (!channel) {
              targets.push({
                ...base,
                delivered: false,
                error: input.dryRun ? null : 'sem canal onde o bot possa falar',
              });
              continue;
            }
            if (input.dryRun) {
              targets.push({ ...base, delivered: false, error: null });
              continue;
            }

            await channel.send({
              embeds: [infoEmbed({ title: input.title, description: input.message })],
            });
            targets.push({ ...base, delivered: true, error: null });
          } catch (error) {
            log.warn({ err: error, guildId }, 'broadcast não chegou');
            targets.push({
              guildId,
              name: guild.name,
              channelId: null,
              channelName: null,
              delivered: false,
              error: describe(error),
            });
          }
        }

        const delivered = targets.filter((target) => target.delivered).length;
        const result: BroadcastResult = {
          dryRun: input.dryRun,
          total: targets.length,
          delivered,
          failed: input.dryRun ? 0 : targets.length - delivered,
          targets,
        };
        if (!input.dryRun) {
          log.warn(
            { by: input.actorId, total: result.total, delivered, failed: result.failed },
            'broadcast enviado',
          );
        }
        return c.json(result);
      })

      .get('/maintenance', (c) => c.json(deps.maintenance.current()))

      .post('/maintenance', validate('json', MaintenanceInputSchema), async (c) => {
        const input = c.req.valid('json');
        requireOwner(options, input.actorId);
        const state = await deps.maintenance.set({
          enabled: input.enabled,
          message: input.message?.trim() ? input.message.trim() : null,
          by: input.actorId,
        });
        return c.json(state);
      })

      /**
       * Força o `PUT` do manifesto no Discord.
       *
       * O boot só registra quando o hash do manifesto mudou, o que é certo em
       * 99% das vezes e inútil no 1% que interessa: quando o hash está certo e
       * o Discord não. Daí `force`.
       */
      .post('/commands/resync', validate('json', ResyncCommandsInputSchema), async (c) => {
        const input = c.req.valid('json');
        requireOwner(options, input.actorId);

        const alvos = input.guildId ? [input.guildId] : deps.registry.servedGuildIds();
        const guilds: ResyncCommandsResult['guilds'] = [];
        for (const guildId of alvos) {
          const name = deps.client.guilds.cache.get(guildId)?.name ?? null;
          try {
            await syncCommands({
              db: deps.db,
              token: options.discordToken,
              clientId: options.clientId,
              guildId,
              commands: deps.commands.values(),
              force: true,
            });
            guilds.push({ guildId, name, registered: true, error: null });
          } catch (error) {
            log.error({ err: error, guildId }, 'falha ao re-registrar comandos');
            guilds.push({ guildId, name, registered: false, error: describe(error) });
          }
        }
        log.warn({ by: input.actorId, guilds: guilds.length }, 'comandos re-registrados');
        return c.json({ count: deps.commands.size, guilds });
      })

      /**
       * O que deu errado desde o boot. O `/metrics` conta; isto mostra quais —
       * que é o que decide se vale abrir o log da VM.
       */
      .get('/diagnostics', (c) =>
        c.json({
          recent: errorLog.recent(RECENT_ERRORS),
          byScope: metrics.errors
            .entries()
            .map((entry) => ({ scope: entry.labels.scope ?? '(sem escopo)', count: entry.value }))
            .sort((a, b) => b.count - a.count),
          commandsTotal: metrics.commands.total(),
        }),
      )
  );
}

/** Manda um embed no canal de aviso. Falhar aqui nunca trava a saída. */
async function announce(guild: Guild, build: () => EmbedBuilder): Promise<boolean> {
  try {
    const channel = noticeChannel(guild);
    if (!channel) return false;
    await channel.send({ embeds: [build()] });
    return true;
  } catch (error) {
    log.warn({ err: error, guildId: guild.id }, 'não consegui avisar antes de sair');
    return false;
  }
}
