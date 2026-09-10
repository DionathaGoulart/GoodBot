'use client';

import { DEFAULT_MODERATION_CONFIG, type GeneralPageValues } from '@goodbot/shared';
import { useFormContext } from 'react-hook-form';

import { ConfigForm } from '@/components/config/config-form';
import {
  ColorField,
  DiscordField,
  NumberField,
  SelectField,
  SwitchField,
} from '@/components/config/fields';
import { Panel } from '@/components/retro/panel';
import { Switch } from '@/components/ui/switch';

/** Os fusos que fazem sentido para um servidor em pt-BR, sem listar o mundo. */
const TIMEZONES = [
  'America/Sao_Paulo',
  'America/Manaus',
  'America/Belem',
  'America/Fortaleza',
  'America/Cuiaba',
  'America/Porto_Velho',
  'America/Rio_Branco',
  'America/Noronha',
  'Europe/Lisbon',
  'UTC',
].map((zone) => ({ value: zone, label: zone }));

const PUNISHMENTS = [
  { key: 'ban', label: 'BAN' },
  { key: 'softban', label: 'SOFTBAN' },
  { key: 'kick', label: 'KICK' },
  { key: 'timeout', label: 'TIMEOUT' },
  { key: 'warn', label: 'WARN' },
] as const;

/**
 * `guild_settings.dm_on_punish` é um **override**: `null` faz o bot cair no
 * `dmOnPunish` do módulo de moderação. Por isso o switch de cima, em vez de
 * cinco switches que fingem ser a única verdade.
 */
function DmOnPunishField() {
  const { watch, setValue, formState } = useFormContext<GeneralPageValues>();
  const value = watch('settings.dmOnPunish');
  const disabled = formState.disabled;

  return (
    <div className="flex flex-col gap-4">
      <label className="flex items-center justify-between gap-4">
        <span className="flex flex-col gap-1">
          <span className="text-sm font-bold uppercase">Definir aqui</span>
          <span className="text-xs opacity-60">
            Desligado, o bot usa o que estiver na tela de moderação.
          </span>
        </span>
        <Switch
          disabled={disabled}
          checked={value !== null}
          aria-label="Definir DM ao punido nesta tela"
          onCheckedChange={(checked) =>
            setValue('settings.dmOnPunish', checked ? DEFAULT_MODERATION_CONFIG.dmOnPunish : null, {
              shouldDirty: true,
            })
          }
        />
      </label>

      {value ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {PUNISHMENTS.map((punishment) => (
            <label key={punishment.key} className="flex items-center justify-between gap-4">
              <span className="section-label">{punishment.label}</span>
              <Switch
                disabled={disabled}
                checked={value[punishment.key]}
                aria-label={`Avisar por DM em ${punishment.label}`}
                onCheckedChange={(checked) =>
                  setValue(
                    'settings.dmOnPunish',
                    { ...value, [punishment.key]: checked },
                    { shouldDirty: true },
                  )
                }
              />
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function GeneralConfigForm({
  values,
  readOnly,
}: {
  values: GeneralPageValues;
  readOnly: boolean;
}) {
  return (
    <ConfigForm page="general" defaultValues={values} readOnly={readOnly}>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="IDENTIDADE.CFG">
          <ColorField
            name="settings.embedColor"
            label="Cor dos embeds"
            description="A barra lateral das mensagens do bot (§9). Status de moderação tem cor própria."
          />
          <SelectField
            name="settings.timezone"
            label="Fuso horário"
            description="Onde o dia começa nos gráficos e nos relatórios diários."
            options={TIMEZONES}
          />
          <SelectField
            name="module.locale"
            label="Idioma"
            description="Por enquanto o bot só fala pt-BR."
            options={[{ value: 'pt-BR', label: 'Português (Brasil)' }]}
          />
        </Panel>

        <Panel title="CARGOS.CFG">
          <DiscordField
            kind="role"
            multiple
            name="settings.modRoleIds"
            label="Cargos de moderador"
            description="Podem usar os comandos de moderação e entram no painel como `mod`."
          />
          <DiscordField
            kind="role"
            multiple
            name="settings.adminRoleIds"
            label="Cargos de administrador"
            description="Podem configurar o bot, aqui e no Discord."
          />
          <DiscordField
            kind="role"
            multiple
            name="settings.dashboardAccessRoleIds"
            label="Acesso ao painel"
            description="Cargos que entram no painel em modo leitura, mesmo sem serem mods."
          />
        </Panel>

        <Panel title="CANAIS.CFG">
          <DiscordField
            kind="channel"
            name="settings.logChannelId"
            label="Canal de logs geral"
            description="Usado pelos tipos de log que não tiverem canal próprio."
            placeholder="Nenhum canal"
          />
        </Panel>

        <Panel title="RESPOSTAS.CFG">
          <SwitchField
            name="module.ephemeralModReplies"
            label="Respostas de moderação efêmeras"
            description="Só quem executou o comando vê a confirmação."
          />
          <SwitchField
            name="module.showCaseNumberInReply"
            label="Mostrar número do caso"
            description="Inclui `Caso #N` na resposta dos comandos de punição."
          />
          <NumberField
            name="module.autoDeleteUtilityRepliesSeconds"
            label="Apagar respostas utilitárias"
            description="Segundos até apagar a resposta de comandos como /purge. 0 mantém."
            min={0}
            max={300}
            suffix="SEGUNDOS"
          />
        </Panel>

        <Panel title="DM.CFG" className="xl:col-span-2">
          <DmOnPunishField />
        </Panel>
      </div>
    </ConfigForm>
  );
}
