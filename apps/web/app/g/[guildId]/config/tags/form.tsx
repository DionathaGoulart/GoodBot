'use client';

import type { TagsConfig } from '@goodbot/shared';

import { ConfigForm } from '@/components/config/config-form';
import { DiscordField, NumberField, SwitchField } from '@/components/config/fields';
import { ModuleToggle } from '@/components/config/module-toggle';
import { Panel } from '@/components/retro/panel';

export function TagsConfigForm({ values, readOnly }: { values: TagsConfig; readOnly: boolean }) {
  return (
    <ConfigForm page="tags" defaultValues={values} readOnly={readOnly}>
      <ModuleToggle description="Respostas prontas chamadas por /tag." />

      <Panel title="PERMISSOES.CFG">
        <DiscordField
          kind="role"
          multiple
          name="managerRoleIds"
          label="Cargos que podem criar tags"
          description="Além dos moderadores. Vazio deixa só os mods."
        />
        <SwitchField
          name="everyoneCanUse"
          label="Qualquer membro pode usar"
          description="Desligado, só quem pode criar consegue chamar /tag."
        />
        <NumberField name="maxTags" label="Limite de tags" min={1} max={1_000} suffix="TAGS" />
        <NumberField
          name="cooldownSeconds"
          label="Cooldown por usuário"
          description="Evita alguém encher o canal com a mesma tag. 0 desliga."
          min={0}
          max={300}
          suffix="SEGUNDOS"
        />
      </Panel>
    </ConfigForm>
  );
}
