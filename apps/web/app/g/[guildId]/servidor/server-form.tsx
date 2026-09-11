'use client';

import * as React from 'react';
import {
  AFK_TIMEOUTS,
  MAX_GUILD_DESCRIPTION_LENGTH,
  MAX_GUILD_NAME_LENGTH,
  MIN_GUILD_NAME_LENGTH,
  VERIFICATION_LEVELS,
  guildGates,
} from '@goodbot/shared';
import { toast } from 'sonner';

import { saveGuildProfileAction } from '@/app/actions/guild';
import { CHANNEL_TYPES, TEXT_CHANNEL_TYPES } from '@/components/config/discord-options';
import { DiscordPicker } from '@/components/config/discord-picker';
import { Blocked, Field, ImageField, type ImageDraft } from '@/components/config/plain-fields';
import { useAutoRefreshPause } from '@/components/layout/auto-refresh';
import { Panel } from '@/components/retro/panel';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useGuildId } from '@/lib/use-guild-id';

import type { GuildProfile } from '@goodbot/shared';

interface Values {
  name: string;
  description: string;
  verificationLevel: number;
  systemChannelId: string | null;
  afkChannelId: string | null;
  afkTimeout: number;
}

function toValues(profile: GuildProfile): Values {
  return {
    name: profile.name,
    description: profile.description ?? '',
    verificationLevel: profile.verificationLevel,
    systemChannelId: profile.systemChannelId,
    afkChannelId: profile.afkChannelId,
    afkTimeout: profile.afkTimeout,
  };
}

const AFK_LABEL: Record<number, string> = {
  60: '1 MINUTO',
  300: '5 MINUTOS',
  900: '15 MINUTOS',
  1800: '30 MINUTOS',
  3600: '1 HORA',
};

/**
 * §6.3 — editar o servidor pelo painel. Nada aqui decide permissão: o
 * `readOnly` e os campos bloqueados são conforto de UI, e quem barra de
 * verdade é a server action (`admin`) e a rota do bot (`ManageGuild` + as
 * features de impulso).
 */
export function ServerForm({ profile, readOnly }: { profile: GuildProfile; readOnly: boolean }) {
  const initial = React.useMemo(() => toValues(profile), [profile]);
  const guildId = useGuildId();
  const [values, setValues] = React.useState<Values>(initial);
  const [icon, setIcon] = React.useState<ImageDraft>(undefined);
  const [banner, setBanner] = React.useState<ImageDraft>(undefined);
  const [saving, setSaving] = React.useState(false);

  const gates = React.useMemo(() => guildGates(profile.features), [profile.features]);
  const noManage = !profile.permissions.manageGuild;
  const locked = readOnly || noManage;

  const dirty =
    icon !== undefined ||
    banner !== undefined ||
    (Object.keys(initial) as (keyof Values)[]).some((key) => values[key] !== initial[key]);
  useAutoRefreshPause(dirty);

  const set = <K extends keyof Values>(key: K, value: Values[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const reset = () => {
    setValues(initial);
    setIcon(undefined);
    setBanner(undefined);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const formData = new FormData();
      formData.set(
        'settings',
        JSON.stringify({
          ...values,
          ...(icon === undefined ? {} : { icon }),
          ...(banner === undefined ? {} : { banner }),
        }),
      );
      const result = await saveGuildProfileAction(guildId, formData);
      if (!result.ok) {
        toast.error('ERRO', { description: result.message ?? 'Não foi possível salvar.' });
        return;
      }
      setIcon(undefined);
      setBanner(undefined);
      toast.success('SALVO', { description: result.message ?? 'Servidor atualizado.' });
    } catch {
      toast.error('ERRO', { description: 'Não foi possível falar com o servidor.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      {noManage ? (
        <Blocked reason="O bot não tem a permissão Gerenciar Servidor. Reconvide-o com ela para editar esta tela." />
      ) : null}

      <fieldset disabled={locked} className="flex min-w-0 flex-col gap-6">
        <Panel title="IDENTIDADE.CFG">
          <Field
            label="Nome"
            hint={`De ${String(MIN_GUILD_NAME_LENGTH)} a ${String(MAX_GUILD_NAME_LENGTH)} caracteres.`}
          >
            <Input
              value={values.name}
              maxLength={MAX_GUILD_NAME_LENGTH}
              onChange={(event) => set('name', event.target.value)}
            />
          </Field>

          <Field
            label="Descrição"
            hint={`Aparece na aba de descoberta. Até ${String(MAX_GUILD_DESCRIPTION_LENGTH)} caracteres.`}
          >
            {gates.description.reason ? <Blocked reason={gates.description.reason} /> : null}
            <Textarea
              rows={2}
              value={values.description}
              disabled={locked || !gates.description.allowed}
              maxLength={MAX_GUILD_DESCRIPTION_LENGTH}
              onChange={(event) => set('description', event.target.value)}
            />
          </Field>

          <ImageField
            label="Ícone"
            hint="PNG, JPEG, GIF ou WEBP, até 8 MB. GIF exige impulso nível 1."
            currentUrl={profile.iconUrl}
            draft={icon}
            onChange={setIcon}
            disabled={locked}
            blocked={null}
            className="size-24"
          />

          <ImageField
            label="Banner"
            hint="Aparece no topo da lista de canais."
            currentUrl={profile.bannerUrl}
            draft={banner}
            onChange={setBanner}
            disabled={locked}
            blocked={gates.banner.reason}
            className="h-24 w-64"
          />
        </Panel>

        <Panel title="MODERACAO.CFG">
          <Field
            label="Nível de verificação"
            hint="Quanto o Discord exige antes de deixar alguém falar."
          >
            <Select
              value={String(values.verificationLevel)}
              disabled={locked}
              onValueChange={(value) => set('verificationLevel', Number(value))}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VERIFICATION_LEVELS.map((level) => (
                  <SelectItem key={level.value} value={String(level.value)}>
                    {level.label} · {level.hint}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </Panel>

        <Panel title="CANAIS.CFG">
          <Field label="Canal de sistema" hint="Onde o Discord anuncia entradas e impulsos.">
            <DiscordPicker
              kind="channel"
              channelTypes={TEXT_CHANNEL_TYPES}
              disabled={locked}
              value={values.systemChannelId ? [values.systemChannelId] : []}
              onChange={(next) => set('systemChannelId', next[0] ?? null)}
            />
          </Field>

          <Field label="Canal de AFK" hint="Para onde quem fica mudo é movido.">
            <DiscordPicker
              kind="channel"
              channelTypes={[CHANNEL_TYPES.voice]}
              disabled={locked}
              value={values.afkChannelId ? [values.afkChannelId] : []}
              onChange={(next) => set('afkChannelId', next[0] ?? null)}
            />
          </Field>

          <Field label="Tempo até o AFK">
            <Select
              value={String(values.afkTimeout)}
              disabled={locked}
              onValueChange={(value) => set('afkTimeout', Number(value))}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AFK_TIMEOUTS.map((seconds) => (
                  <SelectItem key={seconds} value={String(seconds)}>
                    {AFK_LABEL[seconds] ?? `${String(seconds)}s`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </Panel>
      </fieldset>

      {locked ? (
        <p className="screen-meta">MODO LEITURA · SÓ ADMIN PODE SALVAR</p>
      ) : dirty ? (
        <div className="sticky bottom-0 -mx-4 flex items-center justify-between gap-4 border-t-2 border-base-300 bg-base-100 px-4 py-3 sm:-mx-6 sm:px-6">
          <button type="button" className="btn-goodchat-outline" disabled={saving} onClick={reset}>
            DESCARTAR
          </button>
          <button type="submit" className="btn-goodchat" disabled={saving}>
            {saving ? 'SALVANDO_' : 'SALVAR'}
          </button>
        </div>
      ) : null}
    </form>
  );
}
