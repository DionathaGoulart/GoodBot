'use client';

import * as React from 'react';
import {
  AFK_TIMEOUTS,
  IMAGE_REJECTION_MESSAGE,
  MAX_GUILD_DESCRIPTION_LENGTH,
  MAX_GUILD_IMAGE_BYTES,
  MAX_GUILD_NAME_LENGTH,
  MIN_GUILD_NAME_LENGTH,
  VERIFICATION_LEVELS,
  guildGates,
  parseImageDataUrl,
} from '@cobot/shared';
import { toast } from 'sonner';

import { saveGuildProfileAction } from '@/app/actions/guild';
import { CHANNEL_TYPES, TEXT_CHANNEL_TYPES } from '@/components/config/discord-options';
import { DiscordPicker } from '@/components/config/discord-picker';
import { useAutoRefreshPause } from '@/components/layout/auto-refresh';
import { Panel } from '@/components/retro/panel';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

import type { GuildProfile } from '@cobot/shared';

/**
 * Uma imagem do formulário tem três estados, e os três precisam existir:
 * `undefined` não mexe, `null` remove no Discord, a data URL troca.
 */
type ImageDraft = string | null | undefined;

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

/** Campo bloqueado mostra o porquê onde o campo estaria (§8, §6.8). */
function Blocked({ reason }: { reason: string }) {
  return <p className="border-2 border-warning p-3 text-xs text-warning">! {reason}</p>;
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      {hint ? <p className="text-xs opacity-60">{hint}</p> : null}
      {children}
    </div>
  );
}

/**
 * Ícone e banner: preview com a moldura de 2px do §6.2, e a mesma validação
 * que a rota do bot faz — o arquivo é recusado aqui antes de virar 11 MB de
 * base64 subindo para a Vercel.
 */
function ImageField({
  label,
  hint,
  currentUrl,
  draft,
  onChange,
  disabled,
  blocked,
  className,
}: {
  label: string;
  hint?: string;
  currentUrl: string | null;
  draft: ImageDraft;
  onChange: (next: ImageDraft) => void;
  disabled: boolean;
  blocked: string | null;
  className: string;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const shown = draft === undefined ? currentUrl : draft;

  const read = (file: File) => {
    if (file.size > MAX_GUILD_IMAGE_BYTES) {
      toast.error('ERRO', { description: IMAGE_REJECTION_MESSAGE.size });
      return;
    }
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      const url = String(reader.result);
      const parsed = parseImageDataUrl(url);
      if (!parsed.ok) {
        toast.error('ERRO', { description: IMAGE_REJECTION_MESSAGE[parsed.reason] });
        return;
      }
      onChange(url);
    });
    reader.readAsDataURL(file);
  };

  return (
    <Field label={label} hint={hint}>
      {blocked ? <Blocked reason={blocked} /> : null}
      <div className="flex flex-wrap items-start gap-4">
        <span className={`${className} flex items-center justify-center border-2 border-base-300`}>
          {shown ? (
            // Imagens do CDN do Discord e data URLs; `next/image` pediria host
            // liberado e não ganharia nada num preview.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shown} alt="" className="size-full object-cover" />
          ) : (
            <span className="screen-meta">SEM IMAGEM</span>
          )}
        </span>

        <div className="flex flex-col gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) read(file);
              // Zera o input: escolher o mesmo arquivo de novo tem que disparar.
              event.target.value = '';
            }}
          />
          <button
            type="button"
            className="icon-btn"
            disabled={disabled || blocked !== null}
            onClick={() => inputRef.current?.click()}
          >
            ESCOLHER
          </button>
          <button
            type="button"
            className="icon-btn"
            disabled={disabled || blocked !== null || shown === null}
            onClick={() => onChange(null)}
          >
            REMOVER
          </button>
          {draft === undefined ? null : (
            <button type="button" className="icon-btn" onClick={() => onChange(undefined)}>
              DESFAZER
            </button>
          )}
        </div>
      </div>
    </Field>
  );
}

/**
 * §6.3 — editar o servidor pelo painel. Nada aqui decide permissão: o
 * `readOnly` e os campos bloqueados são conforto de UI, e quem barra de
 * verdade é a server action (`admin`) e a rota do bot (`ManageGuild` + as
 * features de impulso).
 */
export function ServerForm({ profile, readOnly }: { profile: GuildProfile; readOnly: boolean }) {
  const initial = React.useMemo(() => toValues(profile), [profile]);
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
      const result = await saveGuildProfileAction(formData);
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
          <Field label="Nome" hint={`De ${String(MIN_GUILD_NAME_LENGTH)} a ${String(MAX_GUILD_NAME_LENGTH)} caracteres.`}>
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
          <Field label="Nível de verificação" hint="Quanto o Discord exige antes de deixar alguém falar.">
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
          <button
            type="button"
            className="btn-goodchat-outline"
            disabled={saving}
            onClick={reset}
          >
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
