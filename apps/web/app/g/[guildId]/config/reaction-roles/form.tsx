'use client';

import type { ReactionRolesConfig } from '@goodbot/shared';

import { ConfigForm } from '@/components/config/config-form';
import { NumberField, SwitchField } from '@/components/config/fields';
import { ModuleToggle } from '@/components/config/module-toggle';
import { Panel } from '@/components/retro/panel';

export function ReactionRolesConfigForm({
  values,
  readOnly,
}: {
  values: ReactionRolesConfig;
  readOnly: boolean;
}) {
  return (
    <ConfigForm page="reaction-roles" defaultValues={values} readOnly={readOnly}>
      <ModuleToggle description="Painéis onde o membro pega cargos sozinho." />
      <Panel title="COMPORTAMENTO.CFG">
        <SwitchField
          name="ephemeralFeedback"
          label="Confirmar em mensagem efêmera"
          description="O membro vê o que ganhou ou perdeu; só ele enxerga."
        />
        <SwitchField
          name="removeReactionAfter"
          label="Tirar a reação depois"
          description="Só vale no estilo por reação: a reação some assim que o cargo é aplicado."
        />
        <NumberField
          name="maxPanels"
          label="Máximo de painéis"
          min={1}
          max={100}
          suffix="PAINÉIS"
        />
      </Panel>
    </ConfigForm>
  );
}
