'use client';

import type { SocialConfig } from '@cobot/shared';

import { ConfigForm } from '@/components/config/config-form';
import { NumberField, SwitchField } from '@/components/config/fields';
import { ModuleToggle } from '@/components/config/module-toggle';
import { Panel } from '@/components/retro/panel';

export function SocialConfigForm({
  values,
  readOnly,
}: {
  values: SocialConfig;
  readOnly: boolean;
}) {
  return (
    <ConfigForm page="social" defaultValues={values} readOnly={readOnly}>
      <ModuleToggle description="Avisa num canal quando as contas configuradas publicam." />

      <Panel title="LIMITES.CFG">
        <NumberField
          name="maxAccounts"
          label="Máximo de contas"
          description="Cada conta é uma chamada HTTP por ciclo; o orçamento da VM é apertado."
          min={1}
          max={20}
          suffix="CONTAS"
        />
        <NumberField
          name="defaultPollIntervalSeconds"
          label="Intervalo padrão"
          description="Usado ao criar uma conta nova. Cada conta pode ter o seu."
          min={60}
          max={21_600}
          suffix="SEGUNDOS"
        />
        <SwitchField
          name="announceBacklog"
          label="Anunciar o que já existia"
          description="Desligado, a primeira passada de uma conta nova só marca as publicações antigas como vistas. Ligado, o feed inteiro cai no canal de uma vez."
        />
      </Panel>
    </ConfigForm>
  );
}
