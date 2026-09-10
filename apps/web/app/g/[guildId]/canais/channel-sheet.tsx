'use client';

import * as React from 'react';
import {
  MANAGED_CHANNEL_TYPES,
  MAX_CHANNEL_NAME_LENGTH,
  MAX_CHANNEL_TOPIC_LENGTH,
  MAX_SLOWMODE_SECONDS,
  OVERRIDE_STATES,
  type ChannelOverride,
  type GuildChannelDetail,
  type OverrideState,
} from '@goodbot/shared';
import { toast } from 'sonner';

import {
  loadChannelDetailAction,
  saveChannelAction,
  setChannelOverridesAction,
} from '@/app/actions/guild';
import { DiscordPicker } from '@/components/config/discord-picker';
import { Tag } from '@/components/retro/tag';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

export interface ChannelEditing {
  /** `null` = criando. */
  id: string | null;
  type: number;
}

interface FormValues {
  name: string;
  topic: string;
  nsfw: boolean;
  slowmodeSeconds: number;
  parentId: string | null;
}

const EMPTY: FormValues = { name: '', topic: '', nsfw: false, slowmodeSeconds: 0, parentId: null };

const OVERRIDE_LABEL: Record<OverrideState, string> = {
  allow: 'LIBERAR',
  deny: 'NEGAR',
  inherit: 'HERDAR',
};

/** Categoria não tem tópico, NSFW nem modo lento; canal de voz também não. */
function isTextual(type: number): boolean {
  return type === MANAGED_CHANNEL_TYPES.text || type === MANAGED_CHANNEL_TYPES.announcement;
}

function OverrideRow({
  override,
  label,
  disabled,
  onChange,
  onRemove,
}: {
  override: ChannelOverride;
  label: string;
  disabled: boolean;
  onChange: (next: ChannelOverride) => void;
  onRemove: () => void;
}) {
  return (
    <div className="grid items-center gap-2 border-2 border-base-300 p-3 sm:grid-cols-[1fr_auto_auto_auto]">
      <span className="font-bold">{label}</span>
      {(['view', 'send'] as const).map((key) => (
        <Select
          key={key}
          value={override[key]}
          disabled={disabled}
          onValueChange={(value) => onChange({ ...override, [key]: value as OverrideState })}
        >
          <SelectTrigger className="min-w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OVERRIDE_STATES.map((state) => (
              <SelectItem key={state} value={state}>
                {key === 'view' ? 'VER' : 'FALAR'}: {OVERRIDE_LABEL[state]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ))}
      <button type="button" className="icon-btn" disabled={disabled} onClick={onRemove}>
        REMOVER
      </button>
    </div>
  );
}

/**
 * Editor de canal (§6.3). O detalhe (tópico, modo lento, overrides) é carregado
 * só quando o painel abre: puxar isso de todo canal ao montar a árvore seria
 * uma chamada por canal para dado que ninguém está olhando.
 */
/**
 * Editor de canal (§6.3). O detalhe (tópico, modo lento, overrides) é carregado
 * só quando o painel abre: puxar isso de todo canal ao montar a árvore seria
 * uma chamada por canal para dado que ninguém está olhando.
 *
 * O corpo é um componente à parte com `key`: trocar de canal remonta o
 * formulário, então o estado nasce certo em vez de ser corrigido num efeito.
 */
function ChannelForm({
  editing,
  categories,
  roleNames,
  readOnly,
  onClose,
}: {
  editing: ChannelEditing;
  categories: { id: string; name: string }[];
  roleNames: Record<string, string>;
  readOnly: boolean;
  onClose: (changed: boolean) => void;
}) {
  const [values, setValues] = React.useState<FormValues>(EMPTY);
  const [overrides, setOverrides] = React.useState<ChannelOverride[]>([]);
  const [loading, setLoading] = React.useState(editing.id !== null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const textual = isTextual(editing.type);
  const channelId = editing.id;

  React.useEffect(() => {
    if (!channelId) return;
    let active = true;

    loadChannelDetailAction(channelId)
      .then((result) => {
        if (!active) return;
        if (!result.ok) {
          setError(result.message);
          return;
        }
        const detail: GuildChannelDetail = result.detail;
        setValues({
          name: detail.name,
          topic: detail.topic ?? '',
          nsfw: detail.nsfw,
          slowmodeSeconds: detail.slowmodeSeconds,
          parentId: detail.parentId,
        });
        setOverrides(detail.overrides);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [channelId]);

  async function saveChannel() {
    setSaving(true);
    try {
      const formData = new FormData();
      if (channelId) formData.set('channelId', channelId);
      formData.set(
        'channel',
        JSON.stringify({
          name: values.name,
          ...(channelId ? {} : { type: editing.type }),
          parentId: values.parentId,
          topic: textual ? values.topic : null,
          nsfw: textual ? values.nsfw : false,
          slowmodeSeconds: textual ? values.slowmodeSeconds : 0,
        }),
      );
      const result = await saveChannelAction(formData);
      if (!result.ok) {
        toast.error('ERRO', { description: result.message });
        return;
      }
      toast.success('SALVO', { description: result.message });
      onClose(true);
    } finally {
      setSaving(false);
    }
  }

  async function saveOverrides() {
    if (!channelId) return;
    setSaving(true);
    try {
      const formData = new FormData();
      formData.set('channelId', channelId);
      formData.set('overrides', JSON.stringify(overrides));
      const result = await setChannelOverridesAction(formData);
      if (!result.ok) {
        toast.error('ERRO', { description: result.message });
        return;
      }
      toast.success('SALVO', { description: result.message });
      onClose(true);
    } finally {
      setSaving(false);
    }
  }

  /** O picker é sempre "vazio + escolha um": ele só serve para entrar na lista. */
  const addOverride = (roleIds: string[]) => {
    const roleId = roleIds.at(-1);
    if (!roleId || overrides.some((override) => override.roleId === roleId)) return;
    setOverrides([...overrides, { roleId, view: 'inherit', send: 'inherit' }]);
  };

  const isCategory = editing.type === MANAGED_CHANNEL_TYPES.category;
  const title = channelId
    ? isCategory
      ? 'EDITAR CATEGORIA'
      : 'EDITAR CANAL'
    : isCategory
      ? 'NOVA CATEGORIA'
      : 'NOVO CANAL';

  return (
    <>
      <SheetHeader>
        <SheetTitle>{title}</SheetTitle>
        <SheetDescription>
          Um override que herda os dois campos é apagado do canal ao salvar.
        </SheetDescription>
      </SheetHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4">
        {error ? <p className="screen-meta text-error-text">! {error}</p> : null}
        {loading ? <p className="screen-meta">CARREGANDO_</p> : null}

        <fieldset disabled={readOnly || loading} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="channel-name">
              Nome<span className="text-accent-text"> *</span>
            </Label>
            <Input
              id="channel-name"
              value={values.name}
              maxLength={MAX_CHANNEL_NAME_LENGTH}
              onChange={(event) => setValues({ ...values, name: event.target.value })}
            />
          </div>

          {isCategory ? null : (
            <div className="flex flex-col gap-2">
              <Label htmlFor="channel-parent">Categoria</Label>
              <Select
                value={values.parentId ?? 'none'}
                onValueChange={(value) =>
                  setValues({ ...values, parentId: value === 'none' ? null : value })
                }
              >
                <SelectTrigger id="channel-parent">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">SEM CATEGORIA</SelectItem>
                  {categories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {textual ? (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="channel-topic">Tópico</Label>
                <Textarea
                  id="channel-topic"
                  rows={3}
                  value={values.topic}
                  maxLength={MAX_CHANNEL_TOPIC_LENGTH}
                  onChange={(event) => setValues({ ...values, topic: event.target.value })}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="channel-slowmode">Modo lento (segundos)</Label>
                <Input
                  id="channel-slowmode"
                  type="number"
                  min={0}
                  max={MAX_SLOWMODE_SECONDS}
                  value={String(values.slowmodeSeconds)}
                  onChange={(event) =>
                    setValues({ ...values, slowmodeSeconds: Number(event.target.value) || 0 })
                  }
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={values.nsfw}
                  onCheckedChange={(checked) => setValues({ ...values, nsfw: checked })}
                />
                Canal NSFW
              </label>
            </>
          ) : null}
        </fieldset>

        {channelId ? (
          <fieldset disabled={readOnly || loading} className="flex flex-col gap-3">
            <legend className="screen-kicker">PERMISSÕES POR CARGO</legend>
            {overrides.length === 0 ? (
              <p className="screen-meta">NENHUM OVERRIDE · O CANAL HERDA TUDO DA CATEGORIA</p>
            ) : (
              overrides.map((override) => (
                <OverrideRow
                  key={override.roleId}
                  override={override}
                  label={roleNames[override.roleId] ?? `@${override.roleId}`}
                  disabled={readOnly || loading}
                  onChange={(next) =>
                    setOverrides(
                      overrides.map((item) => (item.roleId === next.roleId ? next : item)),
                    )
                  }
                  onRemove={() =>
                    setOverrides(overrides.filter((item) => item.roleId !== override.roleId))
                  }
                />
              ))
            )}
            <DiscordPicker
              kind="role"
              value={[]}
              onChange={addOverride}
              placeholder="ADICIONAR CARGO"
              includeEveryone
            />
            <Tag tone="muted">{overrides.length} OVERRIDE(S)</Tag>
          </fieldset>
        ) : null}
      </div>

      {readOnly ? (
        <p className="screen-meta px-4">MODO LEITURA · SÓ ADMIN PODE SALVAR</p>
      ) : (
        <SheetFooter>
          <button
            type="button"
            className="btn-goodchat"
            disabled={saving || loading || values.name.trim().length === 0}
            onClick={saveChannel}
          >
            {saving ? 'SALVANDO_' : 'SALVAR CANAL'}
          </button>
          {channelId ? (
            <button
              type="button"
              className="btn-goodchat-outline"
              disabled={saving || loading}
              onClick={saveOverrides}
            >
              SALVAR PERMISSÕES
            </button>
          ) : null}
        </SheetFooter>
      )}
    </>
  );
}

export function ChannelSheet({
  editing,
  categories,
  roleNames,
  readOnly,
  onClose,
}: {
  editing: ChannelEditing | null;
  categories: { id: string; name: string }[];
  roleNames: Record<string, string>;
  readOnly: boolean;
  onClose: (changed: boolean) => void;
}) {
  return (
    <Sheet open={editing !== null} onOpenChange={(open) => !open && onClose(false)}>
      <SheetContent className="w-full sm:max-w-2xl">
        {editing ? (
          <ChannelForm
            key={`${editing.id ?? 'novo'}:${editing.type}`}
            editing={editing}
            categories={categories}
            roleNames={roleNames}
            readOnly={readOnly}
            onClose={onClose}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
