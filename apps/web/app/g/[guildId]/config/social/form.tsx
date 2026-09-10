'use client';

import type { SocialConfig } from '@goodbot/shared';

import { ConfigForm } from '@/components/config/config-form';
import { NumberField } from '@/components/config/fields';
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
      <ModuleToggle description="Avisa num canal quando os canais configurados publicam no YouTube." />

      <Panel title="POLLING.CFG">
        <NumberField
          name="pollIntervalSeconds"
          label="Checar a cada"
          description="Vale para todos os canais: uma passada percorre a lista inteira e cada canal faz duas requisições ao YouTube. Mudar aqui vale já na próxima passada, sem reiniciar o bot."
          min={60}
          max={1800}
          suffix="SEGUNDOS"
        />
      </Panel>
    </ConfigForm>
  );
}
