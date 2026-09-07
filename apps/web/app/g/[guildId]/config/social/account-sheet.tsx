'use client';

import * as React from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  SOCIAL_DEFAULT_TEMPLATES,
  SOCIAL_EXTERNAL_ID,
  SOCIAL_KINDS_BY_PLATFORM,
  SOCIAL_PLATFORMS,
  SocialAccountInputSchema,
  type SocialAccountInput,
  type SocialKind,
  type SocialPlatform,
  type SocialPlatformStatus,
} from '@cobot/shared';
import { useFormContext, useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { saveSocialAccountAction } from '@/app/actions/social';
import { DiscordField, NumberField, SwitchField, TemplateField, TextField } from '@/components/config/fields';
import { Form, FormDescription, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

import { KIND_LABEL, PLATFORM_LABEL } from './labels';

export const EMPTY_ACCOUNT: SocialAccountInput = {
  platform: 'youtube',
  externalId: '',
  handle: null,
  displayName: null,
  discordChannelId: '',
  kinds: ['video', 'short'],
  template: SOCIAL_DEFAULT_TEMPLATES.youtube,
  mentionRoleId: null,
  enabled: true,
  pollIntervalSeconds: 300,
};

/**
 * Os tipos que a conta anuncia. Cada plataforma aceita um conjunto próprio, e
 * o que o bot não consegue entregar agora (live sem API key) aparece marcado
 * como indisponível em vez de sumir — é a diferença entre "não existe" e
 * "falta uma chave", e o usuário precisa saber qual é.
 */
function KindsField({ platform, status }: { platform: SocialPlatform; status?: SocialPlatformStatus }) {
  const { watch, setValue, formState } = useFormContext<SocialAccountInput>();
  const selected = watch('kinds');
  const supported: readonly SocialKind[] = SOCIAL_KINDS_BY_PLATFORM[platform];
  const available: readonly SocialKind[] = status?.kinds ?? supported;

  const toggle = (kind: SocialKind) => {
    const next: SocialKind[] = selected.includes(kind)
      ? selected.filter((value) => value !== kind)
      : [...selected, kind];
    setValue('kinds', next, { shouldDirty: true, shouldValidate: true });
  };

  return (
    <FormItem>
      <FormLabel>
        Anunciar<span className="text-accent-text"> *</span>
      </FormLabel>
      <FormDescription>O que dispara uma mensagem no canal.</FormDescription>
      <div className="flex flex-wrap gap-2">
        {supported.map((kind) => {
          const usable = available.includes(kind);
          return (
            <button
              key={kind}
              type="button"
              disabled={formState.disabled || !usable}
              className={selected.includes(kind) ? 'icon-btn border-accent text-accent-text' : 'icon-btn'}
              onClick={() => toggle(kind)}
              title={usable ? undefined : 'Indisponível neste bot; veja o aviso da plataforma.'}
            >
              {KIND_LABEL[kind].toUpperCase()}
              {usable ? '' : ' (N/D)'}
            </button>
          );
        })}
      </div>
      <FormMessage />
    </FormItem>
  );
}

export interface AccountEditing {
  account: SocialAccountInput;
  /** `null` = criando. */
  id: string | null;
}

/**
 * Editor de conta. O formulário troca template e tipos padrão ao mudar de
 * plataforma, porque um template de live não faz sentido num feed de fotos.
 */
export function AccountSheet({
  editing,
  platforms,
  embedColor,
  readOnly,
  onClose,
}: {
  editing: AccountEditing | null;
  platforms: SocialPlatformStatus[];
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
  const platform = form.watch('platform');
  const status = platforms.find((item) => item.platform === platform);
  const format = SOCIAL_EXTERNAL_ID[platform];

  React.useEffect(() => {
    if (editing) form.reset(editing.account);
  }, [editing, form]);

  /** Trocar de plataforma reinicia o que só faz sentido nela. */
  const changePlatform = (next: SocialPlatform) => {
    form.setValue('platform', next, { shouldDirty: true });
    form.setValue('kinds', [...SOCIAL_KINDS_BY_PLATFORM[next]], { shouldDirty: true });
    form.setValue('template', SOCIAL_DEFAULT_TEMPLATES[next], { shouldDirty: true });
  };

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
          <SheetTitle>{editing?.id ? 'EDITAR CONTA' : 'NOVA CONTA'}</SheetTitle>
          <SheetDescription>
            O bot só olha o feed: nada é publicado em seu nome em nenhuma rede.
          </SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form
            onSubmit={onSubmit}
            className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4"
          >
            <fieldset disabled={readOnly} className="flex flex-col gap-4">
              <FormItem>
                <FormLabel>
                  Plataforma<span className="text-accent-text"> *</span>
                </FormLabel>
                <div className="flex flex-wrap gap-2">
                  {SOCIAL_PLATFORMS.map((value) => (
                    <button
                      key={value}
                      type="button"
                      disabled={readOnly || Boolean(editing?.id)}
                      className={value === platform ? 'icon-btn border-accent text-accent-text' : 'icon-btn'}
                      onClick={() => changePlatform(value)}
                    >
                      {PLATFORM_LABEL[value].toUpperCase()}
                    </button>
                  ))}
                </div>
                {editing?.id ? (
                  <FormDescription>
                    A plataforma não muda depois de criada: crie outra conta.
                  </FormDescription>
                ) : null}
              </FormItem>

              {status && !status.available ? (
                <p className="border-2 border-warning p-3 text-warning-text">{status.reason}</p>
              ) : null}

              <TextField
                name="externalId"
                label={format.label}
                description={format.hint}
                placeholder={format.label}
                required
              />
              <TextField
                name="displayName"
                label="Nome de exibição"
                description="Como a conta aparece nas listas do painel. Opcional."
              />
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
              <KindsField platform={platform} {...(status ? { status } : {})} />
              <NumberField
                name="pollIntervalSeconds"
                label="Checar a cada"
                description="Mínimo 60s. Lives do YouTube usam 15 min de qualquer forma, por causa da cota da API."
                min={60}
                max={21_600}
                suffix="SEGUNDOS"
              />
              <TemplateField
                name="template"
                label="Mensagem"
                description="Variáveis: {title}, {url}, {author}, {platform}, {kind}. A capa da publicação vira a imagem do embed."
                embedColor={embedColor}
                required
              />
              <SwitchField
                name="enabled"
                label="Conta ligada"
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
