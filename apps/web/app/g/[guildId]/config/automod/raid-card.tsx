'use client';

import { useRouter } from 'next/navigation';

import { setRaidModeAction } from '@/app/actions/modules';
import { ActionButton } from '@/components/config/confirm-button';
import { Panel } from '@/components/retro/panel';
import { Tag } from '@/components/retro/tag';

import type { RaidModeState } from '@goodbot/shared';

/**
 * §6.2 — o card anti-raid. O estado vive na memória do bot, não no banco:
 * `null` aqui significa API interna fora do ar (§8), e aí os botões ficam
 * desabilitados em vez de mentir sobre o estado.
 */
export function RaidCard({ state, readOnly }: { state: RaidModeState | null; readOnly: boolean }) {
  const router = useRouter();
  const offline = state === null;
  const active = state?.active ?? false;

  return (
    <Panel title="ANTIRAID.SYS" tone={active ? 'error' : undefined}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-2">
          <span className="flex items-center gap-2">
            <span className="section-label">MODO RAID</span>
            <Tag tone={offline ? 'muted' : active ? 'error' : 'success'}>
              {offline ? 'DESCONHECIDO' : active ? 'ATIVO' : 'DESLIGADO'}
            </Tag>
          </span>
          <p className="text-sm opacity-70">
            {offline
              ? 'O bot não respondeu, então não dá para ler nem mudar o modo raid agora.'
              : active
                ? `Ligado ${state?.source === 'manual' ? 'à mão' : 'pelo gatilho automático'}` +
                  (state?.until
                    ? ` · até ${new Date(state.until).toLocaleTimeString('pt-BR')}`
                    : '')
                : 'Entradas novas passam pelas regras normais. Ative para tratar todas pela regra anti-raid.'}
          </p>
        </div>

        {readOnly ? (
          <p className="screen-meta">SÓ ADMIN PODE MUDAR</p>
        ) : (
          <ActionButton
            className={active ? 'btn-goodchat-outline' : 'btn-goodchat-danger'}
            label={active ? 'DESATIVAR MODO RAID' : 'ATIVAR MODO RAID'}
            busyLabel="APLICANDO_"
            disabled={offline}
            successTitle={active ? 'DESATIVADO' : 'ATIVADO'}
            action={() => {
              const formData = new FormData();
              formData.set('active', String(!active));
              return setRaidModeAction(formData);
            }}
            onDone={() => router.refresh()}
          />
        )}
      </div>
    </Panel>
  );
}
