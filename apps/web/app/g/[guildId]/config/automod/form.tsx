'use client';

import type { AutomodConfig } from '@goodbot/shared';

import { ConfigForm } from '@/components/config/config-form';
import { DiscordField, NumberField, SwitchField } from '@/components/config/fields';
import { ModuleToggle } from '@/components/config/module-toggle';
import { Panel } from '@/components/retro/panel';

/**
 * §6.2 — o config global do automod: só isenções e limites de execução. As
 * regras em si moram na tabela ao lado, cada uma numa linha de `automod_rules`.
 */
export function AutomodConfigForm({
  values,
  readOnly,
}: {
  values: AutomodConfig;
  readOnly: boolean;
}) {
  return (
    <ConfigForm page="automod" defaultValues={values} readOnly={readOnly}>
      <ModuleToggle description="Filtros automáticos de mensagens e entradas." />
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="ISENCOES.CFG">
          <DiscordField
            name="exemptRoleIds"
            kind="role"
            multiple
            label="Cargos isentos"
            description="Isentos de todas as regras, inclusive as anti-raid."
            placeholder="Nenhum cargo isento"
          />
          <DiscordField
            name="exemptChannelIds"
            kind="channel"
            multiple
            label="Canais isentos"
            placeholder="Nenhum canal isento"
          />
          <SwitchField
            name="exemptModerators"
            label="Isentar a moderação"
            description="Quem tem Gerenciar mensagens ou é admin não é filtrado."
          />
        </Panel>

        <Panel title="EXECUCAO.CFG">
          <SwitchField
            name="checkEdits"
            label="Avaliar edições"
            description="Uma mensagem editada volta a passar pelas regras."
          />
          <NumberField
            name="regexTimeoutMs"
            label="Timeout de regex"
            description="Teto por padrão do filtro de palavras em modo regex."
            min={5}
            max={500}
            suffix="MS"
          />
        </Panel>
      </div>
    </ConfigForm>
  );
}
