'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { setMemberRolesAction } from '@/app/actions/guild';
import { DiscordPicker } from '@/components/config/discord-picker';
import { Panel } from '@/components/retro/panel';
import { Tag } from '@/components/retro/tag';
import { useGuildId } from '@/lib/use-guild-id';

import type { GuildMemberDetail } from '@goodbot/shared';

/**
 * §6.3 — cargos do membro. O que sai daqui é o diff (`add`/`remove`), não a
 * lista inteira: assim um cargo dado no Discord entre o carregamento e o
 * salvamento não é apagado sem querer.
 */
export function MemberRoles({
  member,
  roleNames,
  readOnly,
}: {
  member: GuildMemberDetail;
  roleNames: Record<string, string>;
  readOnly: boolean;
}) {
  const guildId = useGuildId();
  const router = useRouter();
  const current = React.useMemo(
    // O `@everyone` vem no `roleIds` e não é escolhível no picker.
    () => member.roleIds.filter((roleId) => roleNames[roleId] !== undefined),
    [member.roleIds, roleNames],
  );
  const [selected, setSelected] = React.useState<string[]>(current);
  const [saving, setSaving] = React.useState(false);

  // Depois de salvar, o `router.refresh()` traz cargos novos: o rascunho volta
  // a acompanhá-los. Ajustar em render é o caminho recomendado pelo React para
  // estado derivado de prop — num efeito viraria uma renderização em cascata.
  const currentKey = current.join(',');
  const [syncedKey, setSyncedKey] = React.useState(currentKey);
  if (syncedKey !== currentKey) {
    setSyncedKey(currentKey);
    setSelected(current);
  }

  const add = selected.filter((roleId) => !current.includes(roleId));
  const remove = current.filter((roleId) => !selected.includes(roleId));
  const dirty = add.length > 0 || remove.length > 0;

  async function save() {
    setSaving(true);
    try {
      const formData = new FormData();
      formData.set('userId', member.id);
      formData.set('roles', JSON.stringify({ add, remove }));
      const result = await setMemberRolesAction(guildId, formData);
      if (!result.ok) {
        toast.error('ERRO', { description: result.message });
        return;
      }
      toast.success('SALVO', { description: result.message });
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel title="CARGOS.SET">
      {readOnly ? (
        <>
          <div className="flex flex-wrap gap-1.5">
            {current.length === 0 ? (
              <span className="screen-meta">NENHUM CARGO</span>
            ) : (
              current.map((roleId) => <Tag key={roleId}>{roleNames[roleId]}</Tag>)
            )}
          </div>
          <p className="screen-meta">MODO LEITURA · SÓ ADMIN MEXE EM CARGOS</p>
        </>
      ) : (
        <>
          <DiscordPicker kind="role" multiple value={selected} onChange={setSelected} />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-goodchat"
              disabled={!dirty || saving}
              onClick={save}
            >
              {saving ? 'SALVANDO_' : 'SALVAR CARGOS'}
            </button>
            {dirty ? (
              <button
                type="button"
                className="btn-goodchat-outline"
                disabled={saving}
                onClick={() => setSelected(current)}
              >
                DESCARTAR
              </button>
            ) : null}
            <span className="screen-meta">
              {dirty ? `+${add.length} / -${remove.length}` : 'SEM MUDANÇAS'}
            </span>
          </div>
        </>
      )}
    </Panel>
  );
}
