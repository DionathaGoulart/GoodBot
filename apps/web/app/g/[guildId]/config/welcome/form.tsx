'use client';

import { BOOST_TEMPLATE_VARIABLES, MEMBER_TEMPLATE_VARIABLES } from '@cobot/shared';

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

/**
 * A tela oferecia todas as variáveis, inclusive as de rede social — `{title}`
 * numa mensagem de entrada nunca teria valor. Cada campo agora só lista o que
 * sabe preencher.
 */
const BOOST_VARIABLES = [...MEMBER_TEMPLATE_VARIABLES, ...BOOST_TEMPLATE_VARIABLES] as const;

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
      <ModuleToggle description="Mensagens de entrada, de saída, de impulso e a DM de boas-vindas." />

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
        <TemplateField
          name="join.template"
          label="Mensagem"
          embedColor={embedColor}
          variables={MEMBER_TEMPLATE_VARIABLES}
        />
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
        <TemplateField
          name="leave.template"
          label="Mensagem"
          embedColor={embedColor}
          variables={MEMBER_TEMPLATE_VARIABLES}
        />
        <NumberField
          name="leave.deleteAfterSeconds"
          label="Apagar depois de"
          min={0}
          max={86_400}
          suffix="SEGUNDOS"
        />
      </Panel>

      <Panel
        title="IMPULSO.CFG"
        actions={<TestSendButton channelPath="boost.channelId" templatePath="boost.template" />}
      >
        <SwitchField
          name="boost.enabled"
          label="Agradecer quem impulsiona"
          description="Vale também quando alguém para de impulsionar: o cargo é retirado, mas nada é anunciado."
        />
        <DiscordField
          kind="channel"
          name="boost.channelId"
          label="Canal"
          placeholder="Nenhum canal"
        />
        <TemplateField
          name="boost.template"
          label="Mensagem"
          embedColor={embedColor}
          variables={BOOST_VARIABLES}
        />
        <DiscordField
          kind="role"
          name="boost.roleId"
          label="Cargo de quem impulsiona"
          description="Dado enquanto o impulso durar. Precisa estar abaixo do cargo do bot."
          placeholder="Nenhum cargo"
        />
      </Panel>

      <Panel title="DM.CFG">
        <SwitchField
          name="dm.enabled"
          label="Mandar DM para quem entra"
          description="Membros com DM fechada simplesmente não recebem; o bot não avisa ninguém."
        />
        <TemplateField
          name="dm.template"
          label="Mensagem"
          embedColor={embedColor}
          variables={MEMBER_TEMPLATE_VARIABLES}
        />
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
