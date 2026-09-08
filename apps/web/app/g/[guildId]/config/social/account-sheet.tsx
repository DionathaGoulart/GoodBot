'use client';

import * as React from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  SOCIAL_DEFAULT_TEMPLATE,
  SOCIAL_KIND_HEADLINE,
  SOCIAL_KIND_LABEL,
  SOCIAL_KINDS,
  SOCIAL_TEMPLATE_VARIABLES,
  SocialAccountInputSchema,
  type SocialAccountInput,
  type SocialKind,
} from '@cobot/shared';
import { useFormContext, useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { resolveSocialChannelAction, saveSocialAccountAction } from '@/app/actions/social';
import { DiscordField, SwitchField, TemplateField } from '@/components/config/fields';
import type { TemplatePreviewMode } from '@/components/config/template-editor';
import { AvatarSq } from '@/components/retro/avatar-sq';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

export const EMPTY_ACCOUNT: SocialAccountInput = {
  platform: 'youtube',
  externalId: '',
  handle: null,
  displayName: null,
  avatarUrl: null,
  discordChannelId: '',
  kinds: [...SOCIAL_KINDS],
  template: SOCIAL_DEFAULT_TEMPLATE,
  mentionRoleId: null,
  enabled: true,
};

/** Um título de exemplo por tipo, para o preview não dizer "vídeo" numa live. */
const PREVIEW_TITLE: Record<SocialKind, string> = {
  video: 'Título do vídeo novo',
  short: 'Título do short',
  live: 'Título da transmissão',
};

/**
 * O mesmo template renderizado nos três tipos. `{headline}` e `{kind}` mudam a
 * frase inteira, então ver só o caso "vídeo" esconderia justamente o texto que
 * costuma sair errado (PRD §5.8).
 */
const PREVIEW_MODES: TemplatePreviewMode[] = SOCIAL_KINDS.map((kind) => ({
  id: kind,
  label: SOCIAL_KIND_LABEL[kind].toUpperCase(),
  vars: {
    kind: SOCIAL_KIND_LABEL[kind],
    headline: SOCIAL_KIND_HEADLINE[kind],
    title: PREVIEW_TITLE[kind],
    url:
      kind === 'short'
        ? 'https://www.youtube.com/shorts/dQw4w9WgXcQ'
        : 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  },
}));

/**
 * O campo que resolve o canal. Quem fala com o YouTube é o bot: o painel manda
 * o que a pessoa colou (URL, `@handle` ou `UC…`) e recebe de volta o `UC…` com
 * nome e avatar. Salvar sem passar por aqui é impossível — `externalId` é o
 * campo do formulário e ele só é preenchido pela resolução.
 */
function ChannelField({ readOnly }: { readOnly: boolean }) {
  const { watch, setValue, setError, clearErrors } = useFormContext<SocialAccountInput>();
  const externalId = watch('externalId');
  const displayName = watch('displayName');
  const handle = watch('handle');
  const avatarUrl = watch('avatarUrl');

  const [query, setQuery] = React.useState('');
  const [searching, setSearching] = React.useState(false);
  // Na edição o cartão já vem pronto; a busca só volta com `TROCAR CANAL`.
  const [changing, setChanging] = React.useState(false);
  const showSearch = externalId === '' || changing;

  const search = async () => {
    const value = query.trim();
    if (value === '') {
      setError('externalId', { message: 'Cole a URL, o @handle ou o ID do canal.' });
      return;
    }

    setSearching(true);
    try {
      const result = await resolveSocialChannelAction(value);
      if (!result.ok) {
        setError('externalId', { message: result.message });
        return;
      }
      const { channelId, title, handle: resolvedHandle, avatarUrl: resolvedAvatar } = result.channel;
      const dirty = { shouldDirty: true };
      setValue('externalId', channelId, { ...dirty, shouldValidate: true });
      setValue('displayName', title, dirty);
      setValue('handle', resolvedHandle, dirty);
      setValue('avatarUrl', resolvedAvatar, dirty);
      clearErrors('externalId');
      setQuery('');
      setChanging(false);
    } finally {
      setSearching(false);
    }
  };

  return (
    <FormField
      name="externalId"
      render={() => (
        <FormItem>
          <FormLabel>
            Canal do YouTube<span className="text-accent-text"> *</span>
          </FormLabel>
          <FormDescription>
            Cole a URL da barra de endereços, o @handle ou o ID (UC…). O bot confirma que o canal
            existe antes de salvar.
          </FormDescription>

          {showSearch ? (
            <div className="flex flex-wrap items-center gap-2">
              <FormControl>
                <Input
                  className="min-w-0 flex-1"
                  disabled={readOnly || searching}
                  placeholder="youtube.com/@canal"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  // Enter dentro do campo buscaria e salvaria ao mesmo tempo:
                  // o submit do formulário fica para o botão SALVAR.
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    void search();
                  }}
                />
              </FormControl>
              <button
                type="button"
                className="icon-btn"
                disabled={readOnly || searching}
                onClick={() => void search()}
              >
                {searching ? 'BUSCANDO_' : 'BUSCAR'}
              </button>
              {externalId === '' ? null : (
                <button type="button" className="icon-btn" onClick={() => setChanging(false)}>
                  CANCELAR
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-3 border-2 border-base-300 bg-base-100 p-3">
              <AvatarSq src={avatarUrl} name={displayName ?? externalId} size={40} />
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-bold">{displayName ?? externalId}</span>
                <span className="screen-meta truncate">{handle ?? externalId}</span>
              </span>
              {readOnly ? null : (
                <button
                  type="button"
                  className="icon-btn ml-auto shrink-0"
                  onClick={() => setChanging(true)}
                >
                  TROCAR CANAL
                </button>
              )}
            </div>
          )}

          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/** Os três tipos que o YouTube entrega. Todos disponíveis: não há chave nem cota. */
function KindsField() {
  const { watch, setValue, formState } = useFormContext<SocialAccountInput>();
  const selected = watch('kinds');

  const toggle = (kind: SocialKind) => {
    const next: SocialKind[] = selected.includes(kind)
      ? selected.filter((value) => value !== kind)
      : [...selected, kind];
    setValue('kinds', next, { shouldDirty: true, shouldValidate: true });
  };

  // `FormField` é o que dá contexto a `FormLabel`/`FormMessage`; sem ele os
  // dois estouram no primeiro render da sheet, mesmo sem nenhum erro de campo.
  return (
    <FormField
      name="kinds"
      render={() => (
        <FormItem>
          <FormLabel>
            O que anunciar<span className="text-accent-text"> *</span>
          </FormLabel>
          <FormDescription>O que dispara uma mensagem no canal do Discord.</FormDescription>
          <div className="flex flex-col gap-2">
            {SOCIAL_KINDS.map((kind) => (
              <label key={kind} className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox
                  checked={selected.includes(kind)}
                  disabled={formState.disabled}
                  onCheckedChange={() => toggle(kind)}
                />
                {SOCIAL_KIND_LABEL[kind].toUpperCase()}
              </label>
            ))}
          </div>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export interface AccountEditing {
  account: SocialAccountInput;
  /** `null` = criando. */
  id: string | null;
}

/** Editor de um canal observado. */
export function AccountSheet({
  editing,
  embedColor,
  readOnly,
  onClose,
}: {
  editing: AccountEditing | null;
  embedColor: number;
  readOnly: boolean;
  onClose: (changed: boolean) => void;
}) {
  const form = useForm<SocialAccountInput>({
    // `as never`: o schema tem defaults, então a entrada do resolver é mais
    // frouxa que a saída e o RHF não reconcilia os dois genéricos sozinho.
    resolver: zodResolver(SocialAccountInputSchema as never),
    defaultValues: editing?.account ?? EMPTY_ACCOUNT,
    disabled: readOnly,
  });
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (editing) form.reset(editing.account);
  }, [editing, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    setSaving(true);
    try {
      const formData = new FormData();
      formData.set('account', JSON.stringify(values));
      if (editing?.id) formData.set('accountId', editing.id);
      const result = await saveSocialAccountAction(formData);
      if (!result.ok) {
        for (const [path, message] of Object.entries(result.fieldErrors ?? {})) {
          form.setError(path as never, { message });
        }
        toast.error('ERRO', { description: result.message });
        return;
      }
      toast.success('SALVO', { description: result.message });
      onClose(true);
    } finally {
      setSaving(false);
    }
  });

  return (
    <Sheet open={editing !== null} onOpenChange={(open) => !open && onClose(false)}>
      <SheetContent className="w-full sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>{editing?.id ? 'EDITAR CANAL' : 'NOVO CANAL'}</SheetTitle>
          <SheetDescription>
            O bot só olha o feed público: nada é publicado em seu nome no YouTube.
          </SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form
            onSubmit={onSubmit}
            className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4"
          >
            <fieldset disabled={readOnly} className="flex flex-col gap-4">
              <ChannelField readOnly={readOnly} />
              <DiscordField
                kind="channel"
                name="discordChannelId"
                label="Canal do anúncio"
                required
              />
              <DiscordField
                kind="role"
                name="mentionRoleId"
                label="Cargo mencionado"
                description="Único cargo que a mensagem pode pingar. Deixe vazio para não mencionar ninguém."
                placeholder="Nenhum cargo"
              />
              <KindsField />
              <TemplateField
                name="template"
                label="Mensagem"
                description="{headline} vira “publicou um vídeo novo”, “publicou um short” ou “está ao vivo”, conforme o caso — troque o tipo no preview para conferir os três. A capa da publicação vira a imagem do embed."
                embedColor={embedColor}
                variables={SOCIAL_TEMPLATE_VARIABLES}
                previewModes={PREVIEW_MODES}
                required
              />
              <SwitchField
                name="enabled"
                label="Canal ligado"
                description="Salvar com isto ligado também zera o contador de falhas."
              />
            </fieldset>

            {readOnly ? (
              <p className="screen-meta">MODO LEITURA · SÓ ADMIN PODE SALVAR</p>
            ) : (
              <SheetFooter className="px-0">
                <button type="submit" className="btn-goodchat" disabled={saving}>
                  {saving ? 'SALVANDO_' : 'SALVAR'}
                </button>
              </SheetFooter>
            )}
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
