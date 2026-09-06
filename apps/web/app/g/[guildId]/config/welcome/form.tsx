'use client';

import type { WelcomeConfig } from '@cobot/shared';

import { ConfigForm } from '@/components/config/config-form';
import {
  DiscordField,
  NumberField,
  SwitchField,
  TemplateField,
} from '@/components/config/fields';
import { ModuleToggle } from '@/components/config/module-toggle';
import { TestSendButton } from '@/components/config/test-send-button';
import { Panel } from '@/components/retro/panel';

export function WelcomeConfigForm({
  values,
  embedColor,
  readOnly,
}: {
  values: WelcomeConfig;
  embedColor: number;
  readOnly: boolean;
}) {
  return (
    <ConfigForm page="welcome" defaultValues={values} readOnly={readOnly}>
      <ModuleToggle description="Mensagens de entrada, de saída e a DM de boas-vindas." />

      <Panel
        title="ENTRADA.CFG"
        actions={<TestSendButton channelPath="join.channelId" templatePath="join.template" />}
      >
        <SwitchField name="join.enabled" label="Anunciar quem entra" />
        <DiscordField
          kind="channel"
          name="join.channelId"
          label="Canal"
          placeholder="Nenhum canal"
        />
        <TemplateField name="join.template" label="Mensagem" embedColor={embedColor} />
        <NumberField
          name="join.deleteAfterSeconds"
          label="Apagar depois de"
          description="0 mantém a mensagem para sempre."
          min={0}
          max={86_400}
          suffix="SEGUNDOS"
        />
      </Panel>

      <Panel
        title="SAIDA.CFG"
        actions={<TestSendButton channelPath="leave.channelId" templatePath="leave.template" />}
      >
        <SwitchField name="leave.enabled" label="Anunciar quem sai" />
        <DiscordField
          kind="channel"
          name="leave.channelId"
          label="Canal"
          placeholder="Nenhum canal"
        />
        <TemplateField name="leave.template" label="Mensagem" embedColor={embedColor} />
        <NumberField
          name="leave.deleteAfterSeconds"
          label="Apagar depois de"
          min={0}
          max={86_400}
          suffix="SEGUNDOS"
        />
      </Panel>

      <Panel title="DM.CFG">
        <SwitchField
          name="dm.enabled"
          label="Mandar DM para quem entra"
          description="Membros com DM fechada simplesmente não recebem; o bot não avisa ninguém."
        />
        <TemplateField name="dm.template" label="Mensagem" embedColor={embedColor} />
      </Panel>

      <Panel title="OPCOES.CFG">
        <SwitchField
          name="ignoreBots"
          label="Ignorar bots"
          description="Bots entrando não geram mensagem de boas-vindas."
        />
      </Panel>
    </ConfigForm>
  );
}
