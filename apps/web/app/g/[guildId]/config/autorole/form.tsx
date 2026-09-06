'use client';

import { useFormContext } from 'react-hook-form';

import { ConfigForm } from '@/components/config/config-form';
import {
  DiscordField,
  NumberField,
  SwitchField,
  TextField,
} from '@/components/config/fields';
import { ModuleToggle } from '@/components/config/module-toggle';
import { Panel } from '@/components/retro/panel';

import type { AutoroleConfig } from '@cobot/shared';

/**
 * A mensagem de verificação é publicada pelo comando `/verify painel` — o
 * painel só mostra o ID para dar para achar a mensagem no Discord.
 */
function PublishedMessage() {
  const messageId = useFormContext<AutoroleConfig>().watch('verify.messageId');

  return (
    <p className="screen-meta">
      MENSAGEM PUBLICADA: {messageId ? <code className="select-all">{messageId}</code> : 'NENHUMA'}
    </p>
  );
}

export function AutoroleConfigForm({
  values,
  readOnly,
}: {
  values: AutoroleConfig;
  readOnly: boolean;
}) {
  return (
    <ConfigForm page="autorole" defaultValues={values} readOnly={readOnly}>
      <ModuleToggle description="Cargos entregues na entrada e verificação por botão." />

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="CARGOS.CFG">
          <DiscordField
            kind="role"
            multiple
            name="humanRoleIds"
            label="Cargos para pessoas"
            description="O bot precisa estar acima deles na hierarquia para conseguir aplicar."
          />
          <DiscordField
            kind="role"
            multiple
            name="botRoleIds"
            label="Cargos para bots"
            description="Aplicados quando quem entra é um bot."
          />
          <NumberField
            name="delaySeconds"
            label="Atraso"
            description="Segundos de espera antes de aplicar. 0 aplica na hora."
            min={0}
            max={3_600}
            suffix="SEGUNDOS"
          />
        </Panel>

        <Panel title="VERIFICACAO.CFG">
          <SwitchField
            name="verify.enabled"
            label="Exigir verificação por botão"
            description="O cargo só é dado depois que a pessoa clica no botão."
          />
          <DiscordField
            kind="channel"
            name="verify.channelId"
            label="Canal do painel"
            placeholder="Nenhum canal"
          />
          <DiscordField kind="role" name="verify.roleId" label="Cargo entregue" />
          <TextField name="verify.buttonLabel" label="Texto do botão" required />
          <PublishedMessage />
        </Panel>
      </div>
    </ConfigForm>
  );
}
