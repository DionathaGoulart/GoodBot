'use client';

import * as React from 'react';
import { MAX_BOT_BIO_LENGTH, MAX_BOT_NICK_LENGTH } from '@goodbot/shared';
import { toast } from 'sonner';

import { saveBotProfileAction } from '@/app/actions/guild';
import { Blocked, Field, ImageField, type ImageDraft } from '@/components/config/plain-fields';
import { Panel } from '@/components/retro/panel';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useGuildId } from '@/lib/use-guild-id';

import type { BotProfile } from '@goodbot/shared';

/**
 * §6.6 — como o bot aparece **neste** servidor. Cada servidor tem o seu
 * apelido, avatar e capa; o que ficar vazio cai no perfil global do bot, que é
 * o mesmo em todo lugar.
 *
 * Nada aqui decide permissão: o `readOnly` e o aviso de apelido são conforto
 * de UI, e quem barra de verdade é a server action (`admin`) e a rota do bot
 * (`CHANGE_NICKNAME` para o apelido).
 */
export function BotProfileForm({ profile, readOnly }: { profile: BotProfile; readOnly: boolean }) {
  const guildId = useGuildId();
  const initialNick = profile.nick ?? '';
  const initialBio = profile.bio ?? '';
  const [nick, setNick] = React.useState(initialNick);
  const [bio, setBio] = React.useState(initialBio);
  const [avatar, setAvatar] = React.useState<ImageDraft>(undefined);
  const [banner, setBanner] = React.useState<ImageDraft>(undefined);
  const [saving, setSaving] = React.useState(false);

  const noNickname = !profile.permissions.changeNickname;
  const dirty =
    nick !== initialNick || bio !== initialBio || avatar !== undefined || banner !== undefined;

  const reset = () => {
    setNick(initialNick);
    setBio(initialBio);
    setAvatar(undefined);
    setBanner(undefined);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const formData = new FormData();
      formData.set(
        'profile',
        JSON.stringify({
          nick,
          bio,
          ...(avatar === undefined ? {} : { avatar }),
          ...(banner === undefined ? {} : { banner }),
        }),
      );
      const result = await saveBotProfileAction(guildId, formData);
      if (!result.ok) {
        toast.error('ERRO', { description: result.message ?? 'Não foi possível salvar.' });
        return;
      }
      setAvatar(undefined);
      setBanner(undefined);
      toast.success('SALVO', { description: result.message ?? 'Perfil do bot atualizado.' });
    } catch {
      toast.error('ERRO', { description: 'Não foi possível falar com o servidor.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      <fieldset disabled={readOnly} className="flex min-w-0 flex-col gap-6">
        <Panel title="PERFIL.CFG">
          <Field
            label="Apelido"
            hint={`Como o bot é chamado aqui. Vazio usa o nome global (${profile.globalName}). Até ${String(MAX_BOT_NICK_LENGTH)} caracteres.`}
          >
            {noNickname ? (
              <Blocked reason="O bot não tem a permissão Alterar Apelido. Reconvide-o com ela ou libere no cargo dele." />
            ) : null}
            <Input
              value={nick}
              placeholder={profile.globalName}
              maxLength={MAX_BOT_NICK_LENGTH}
              disabled={readOnly || noNickname}
              onChange={(event) => setNick(event.target.value)}
            />
          </Field>

          <Field
            label="Bio"
            hint={`Até ${String(MAX_BOT_BIO_LENGTH)} caracteres. O Discord não devolve a bio de volta, então o painel mostra a última que salvou aqui.`}
          >
            <Textarea
              rows={3}
              value={bio}
              maxLength={MAX_BOT_BIO_LENGTH}
              disabled={readOnly}
              onChange={(event) => setBio(event.target.value)}
            />
          </Field>

          <ImageField
            label="Foto de perfil"
            hint="PNG, JPEG, GIF ou WEBP, até 8 MB. Sem foto própria, vale o avatar global do bot."
            currentUrl={profile.avatarUrl}
            fallbackUrl={profile.globalAvatarUrl}
            draft={avatar}
            onChange={setAvatar}
            disabled={readOnly}
            blocked={null}
            className="size-24"
          />

          <ImageField
            label="Capa"
            hint="Aparece atrás do perfil do bot quando alguém clica nele neste servidor."
            currentUrl={profile.bannerUrl}
            draft={banner}
            onChange={setBanner}
            disabled={readOnly}
            blocked={null}
            className="h-24 w-64"
          />
        </Panel>
      </fieldset>

      {readOnly ? (
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
