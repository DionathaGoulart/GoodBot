'use client';

import * as React from 'react';
import { MAX_EMBED_DESCRIPTION_LENGTH } from '@goodbot/shared';

import { resyncCommandsAction, setMaintenanceAction } from '@/app/actions/admin';
import { Tag } from '@/components/retro/tag';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import { useAdminAction } from '../use-admin-action';

import type { MaintenanceOutcome, ResyncOutcome } from '@/lib/admin';
import type { MaintenanceState, ResyncCommandsResult } from '@goodbot/shared';

/**
 * Modo manutenção e re-registro de comandos.
 *
 * Ligar a manutenção **não** derruba o bot: ele continua online no Discord,
 * continua registrando eventos e continua respondendo `/health` — só recusa
 * interação, com um aviso efêmero. É a diferença entre "estou mexendo no
 * banco" e "caiu", e ela importa: um container derrubado marca o bot como
 * offline e ninguém descobre por quê.
 */
export function MaintenanceForm({ state }: { state: MaintenanceState | null }) {
  const manutencao = useAdminAction<MaintenanceOutcome>();
  const comandos = useAdminAction<ResyncOutcome>();
  const [message, setMessage] = React.useState(state?.message ?? '');
  const [atual, setAtual] = React.useState(state);
  const [resync, setResync] = React.useState<ResyncCommandsResult | null>(null);

  const ligada = atual?.enabled ?? false;
  const indisponivel = state === null;

  function alternar(enabled: boolean) {
    void manutencao
      .run(enabled ? 'ligar' : 'desligar', setMaintenanceAction, {
        enabled: String(enabled),
        message,
      })
      .then((result) => {
        if (result?.ok && result.state) setAtual(result.state);
      });
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Tag tone={ligada ? 'warning' : 'success'}>{ligada ? 'EM MANUTENÇÃO' : 'ATENDENDO'}</Tag>
        {atual?.since ? (
          <span className="screen-meta">
            DESDE {new Date(atual.since).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
          </span>
        ) : null}
        {indisponivel ? <span className="screen-meta">O BOT NÃO RESPONDEU</span> : null}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="maintenance-message">Aviso mostrado a quem tentar usar o bot</Label>
        <Textarea
          id="maintenance-message"
          value={message}
          maxLength={MAX_EMBED_DESCRIPTION_LENGTH}
          rows={3}
          disabled={indisponivel}
          placeholder="Vazio usa o texto padrão do bot."
          onChange={(event) => {
            setMessage(event.target.value);
          }}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {ligada ? (
          <button
            type="button"
            className="btn-goodchat"
            disabled={manutencao.busy !== null || indisponivel}
            onClick={() => {
              alternar(false);
            }}
          >
            {manutencao.busy === 'desligar' ? 'DESLIGANDO_' : 'VOLTAR A ATENDER'}
          </button>
        ) : (
          <button
            type="button"
            className="btn-goodchat-danger"
            disabled={manutencao.busy !== null || indisponivel}
            onClick={() => {
              alternar(true);
            }}
          >
            {manutencao.busy === 'ligar' ? 'LIGANDO_' : 'ENTRAR EM MANUTENÇÃO'}
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t-2 border-base-300 pt-4">
        <p className="section-label sigil">RE-REGISTRAR COMANDOS</p>
        <p className="text-sm opacity-70">
          No boot os slash commands só vão ao Discord quando o manifesto muda. Isto força o envio —
          é o conserto para quando o hash está certo e o Discord não (comando sumido do cliente,
          servidor que entrou durante uma falha de rede).
        </p>
        <div>
          <button
            type="button"
            className="btn-goodchat-outline"
            disabled={comandos.busy !== null}
            onClick={() => {
              void comandos.run('resync', resyncCommandsAction, {}).then((result) => {
                if (result?.ok && result.result) setResync(result.result);
              });
            }}
          >
            {comandos.busy === 'resync' ? 'REGISTRANDO_' : 'FORÇAR RE-REGISTRO'}
          </button>
        </div>
        {resync ? (
          <ul className="flex flex-col gap-1">
            {resync.guilds.map((guild) => (
              <li key={guild.guildId} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{guild.name ?? guild.guildId}</span>
                <Tag tone={guild.registered ? 'success' : 'error'}>
                  {guild.registered ? 'OK' : (guild.error ?? 'FALHOU')}
                </Tag>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </>
  );
}
