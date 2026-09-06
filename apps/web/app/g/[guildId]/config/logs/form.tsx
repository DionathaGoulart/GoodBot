'use client';

import { LOG_KINDS, type LogsPageValues } from '@cobot/shared';

import { ConfigForm } from '@/components/config/config-form';
import { DiscordField, NumberField, SwitchField } from '@/components/config/fields';
import { ModuleToggle } from '@/components/config/module-toggle';
import { Panel } from '@/components/retro/panel';

/** §5.4 — os cinco tipos de log, com o nome que o painel mostra. */
const KIND_LABELS: Record<(typeof LOG_KINDS)[number], { title: string; description: string }> = {
  modlog: { title: 'MOD-LOG', description: 'Casos de moderação: ban, kick, timeout, warn.' },
  messages: { title: 'MENSAGENS', description: 'Edições, exclusões e bulk delete.' },
  members: { title: 'MEMBROS', description: 'Entradas, saídas, apelidos e cargos.' },
  server: { title: 'SERVIDOR', description: 'Canais, cargos e mudanças da guild.' },
  voice: { title: 'VOZ', description: 'Entradas e saídas de canais de voz.' },
};

export function LogsConfigForm({
  values,
  readOnly,
}: {
  values: LogsPageValues;
  readOnly: boolean;
}) {
  return (
    <ConfigForm page="logs" defaultValues={values} readOnly={readOnly}>
      <ModuleToggle
        name="module.enabled"
        description="Sem o módulo ativo nenhum tipo de log é enviado, mesmo os ligados abaixo."
      />

      {LOG_KINDS.map((kind) => (
        <Panel key={kind} title={`${KIND_LABELS[kind].title}.LOG`}>
          <SwitchField
            name={`kinds.${kind}.enabled`}
            label="Ativo"
            description={KIND_LABELS[kind].description}
          />
          <DiscordField
            kind="channel"
            name={`kinds.${kind}.channelId`}
            label="Canal"
            description="Vazio herda o canal de logs geral da tela Geral."
            placeholder="Herdar canal geral"
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <DiscordField
              kind="channel"
              multiple
              name={`kinds.${kind}.ignoredChannelIds`}
              label="Canais ignorados"
            />
            <DiscordField
              kind="role"
              multiple
              name={`kinds.${kind}.ignoredRoleIds`}
              label="Cargos ignorados"
            />
          </div>
        </Panel>
      ))}

      <Panel title="OPCOES.CFG">
        <SwitchField
          name="module.ignoreBots"
          label="Ignorar bots"
          description="Mensagens e edições de bots não geram log."
        />
        <SwitchField
          name="module.logAvatarChanges"
          label="Registrar troca de avatar"
          description="Costuma poluir o log de membros; desligado por padrão."
        />
        <SwitchField
          name="module.bulkDeleteAttachFile"
          label="Anexar .txt no bulk delete"
          description="Manda as mensagens apagadas como arquivo, em vez de só o número."
        />
        <SwitchField
          name="module.messageCache.enabled"
          label="Cache de mensagens"
          description="Sem ele o log de edição/exclusão não consegue mostrar o conteúdo antigo."
        />
        <NumberField
          name="module.messageCache.perChannel"
          label="Mensagens em cache por canal"
          min={10}
          max={1000}
          suffix="MENSAGENS"
        />
      </Panel>
    </ConfigForm>
  );
}
