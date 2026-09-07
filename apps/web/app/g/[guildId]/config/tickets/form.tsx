'use client';

import type { TicketsConfig } from '@cobot/shared';

import { ConfigForm } from '@/components/config/config-form';
import {
  DiscordField,
  NumberField,
  SelectField,
  SwitchField,
  TextField,
} from '@/components/config/fields';
import { ModuleToggle } from '@/components/config/module-toggle';
import { Panel } from '@/components/retro/panel';

export function TicketsConfigForm({
  values,
  readOnly,
}: {
  values: TicketsConfig;
  readOnly: boolean;
}) {
  return (
    <ConfigForm page="tickets" defaultValues={values} readOnly={readOnly}>
      <ModuleToggle description="Canais privados de atendimento abertos pelo painel." />
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="ABERTURA.CFG">
          <SwitchField
            name="useThreads"
            label="Abrir como thread privada"
            description="Desligado, cada ticket vira um canal na categoria do tipo."
          />
          <TextField
            name="namingPattern"
            label="Padrão de nome"
            description="Aceita {number}, {user} e {type}. Os tipos podem sobrescrever."
            required
          />
          <NumberField
            name="maxOpenPerUserDefault"
            label="Tickets abertos por membro"
            min={1}
            max={20}
          />
        </Panel>

        <Panel title="FECHAMENTO.CFG">
          <DiscordField
            name="logChannelId"
            kind="channel"
            label="Canal de log"
            description="Recebe os transcripts e os avisos de abertura e fechamento."
            placeholder="Nenhum canal"
          />
          <SelectField
            name="transcript.format"
            label="Formato do transcript"
            options={[
              { value: 'html', label: 'HTML' },
              { value: 'txt', label: 'TEXTO' },
            ]}
          />
          <SwitchField name="transcript.sendToUser" label="Mandar o transcript ao autor" />
          <SwitchField name="closeConfirm" label="Pedir confirmação ao fechar" />
          <NumberField
            name="autoCloseInactiveHours"
            label="Fechar por inatividade"
            description="0 desliga o fechamento automático."
            min={0}
            max={720}
            suffix="HORAS"
          />
        </Panel>
      </div>
    </ConfigForm>
  );
}
