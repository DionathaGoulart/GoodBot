'use client';

import * as React from 'react';
import { NO_MENTIONS, type AllowedMentions, type MessageTemplate } from '@cobot/shared';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { deleteChannelMessageAction, sendChannelMessageAction } from '@/app/actions/messages';
import { TemplateEditor } from '@/components/config/template-editor';
import { AvatarSq } from '@/components/retro/avatar-sq';
import { Panel } from '@/components/retro/panel';
import { Tag } from '@/components/retro/tag';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import type { ChannelMessageSummary, GuildChannelSummary } from '@cobot/shared';

const EMPTY_TEMPLATE: MessageTemplate = { content: '' };

/** As caixas de menção, na ordem em que aparecem no editor. */
const MENTION_FIELDS = [
  { key: 'users', label: 'USUÁRIOS' },
  { key: 'roles', label: 'CARGOS' },
  { key: 'everyone', label: '@EVERYONE' },
] as const;

/** Por que o botão EDITAR está desabilitado — ou `undefined` quando não está. */
function editHint(message: ChannelMessageSummary): string | undefined {
  if (!message.editable) return 'Só dá para editar mensagens enviadas pelo bot.';
  if (!message.template) return 'Esta mensagem tem partes que o painel não sabe reconstruir.';
  return undefined;
}

function MessageRow({
  message,
  readOnly,
  onEdit,
  onReply,
  onDelete,
}: {
  message: ChannelMessageSummary;
  readOnly: boolean;
  onEdit: (message: ChannelMessageSummary) => void;
  onReply: (message: ChannelMessageSummary) => void;
  onDelete: (message: ChannelMessageSummary) => void;
}) {
  return (
    <li className="flex items-start gap-3 border-b-2 border-base-300 py-3 last:border-b-0">
      <AvatarSq src={message.author.avatarUrl} name={message.author.username} size={24} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold">{message.author.username}</span>
          {message.author.bot ? <Tag tone="muted">BOT</Tag> : null}
          <time dateTime={message.createdAt} title={message.createdAt} className="screen-meta">
            {new Date(message.createdAt).toLocaleString('pt-BR')}
          </time>
          {message.editedAt ? <span className="screen-meta">· EDITADA</span> : null}
        </p>
        <p className="text-sm whitespace-pre-wrap opacity-80">
          {message.content || (message.embedCount > 0 ? '[embed]' : '[sem texto]')}
        </p>
        {message.embedCount > 0 || message.attachmentCount > 0 ? (
          <p className="screen-meta">
            {message.embedCount > 0 ? `${String(message.embedCount)} EMBED(S)` : ''}
            {message.embedCount > 0 && message.attachmentCount > 0 ? ' · ' : ''}
            {message.attachmentCount > 0 ? `${String(message.attachmentCount)} ANEXO(S)` : ''}
          </p>
        ) : null}
      </div>
      {readOnly ? null : (
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            className="icon-btn"
            disabled={!message.editable || message.template === null}
            title={editHint(message)}
            onClick={() => onEdit(message)}
          >
            EDITAR
          </button>
          <button type="button" className="icon-btn" onClick={() => onReply(message)}>
            RESPONDER
          </button>
          <button type="button" className="icon-btn" onClick={() => onDelete(message)}>
            APAGAR
          </button>
        </div>
      )}
    </li>
  );
}

/**
 * §6.2 — o compositor de mensagens. O editor é o mesmo `template-editor` das
 * telas de config (texto, embed e preview ao lado, §6.4), então o que o
 * preview mostra é exatamente o que o bot manda.
 */
export function MessageComposer({
  guildId,
  channels,
  channelId,
  messages,
  historyError,
  embedColor,
  readOnly,
}: {
  guildId: string;
  channels: GuildChannelSummary[];
  channelId: string | null;
  messages: ChannelMessageSummary[];
  historyError: string | null;
  embedColor: number;
  readOnly: boolean;
}) {
  const router = useRouter();

  const [template, setTemplate] = React.useState<MessageTemplate | null>(EMPTY_TEMPLATE);
  const [mentions, setMentions] = React.useState<AllowedMentions>(NO_MENTIONS);
  const [editing, setEditing] = React.useState<ChannelMessageSummary | null>(null);
  const [replyTo, setReplyTo] = React.useState<ChannelMessageSummary | null>(null);
  const [target, setTarget] = React.useState<ChannelMessageSummary | null>(null);
  const [busy, setBusy] = React.useState(false);

  const selected = channels.find((channel) => channel.id === channelId) ?? null;
  const canWrite = !readOnly && selected !== null && selected.canSend !== false;

  function reset() {
    setTemplate(EMPTY_TEMPLATE);
    setMentions(NO_MENTIONS);
    setEditing(null);
    setReplyTo(null);
  }

  /** Responder e editar são excludentes: o Discord não edita uma resposta em outra. */
  function startReply(message: ChannelMessageSummary) {
    setEditing(null);
    setReplyTo(message);
  }

  function startEdit(message: ChannelMessageSummary) {
    if (!message.template) return;
    setEditing(message);
    setReplyTo(null);
    setTemplate(message.template);
    setMentions(NO_MENTIONS);
  }

  async function submit() {
    if (!channelId || !template) return;
    setBusy(true);
    try {
      const formData = new FormData();
      formData.set(
        'message',
        JSON.stringify({
          channelId,
          ...(editing ? { messageId: editing.id } : {}),
          ...(replyTo && !editing ? { replyToId: replyTo.id } : {}),
          template,
          allowedMentions: mentions,
        }),
      );
      const result = await sendChannelMessageAction(formData);
      if (!result.ok) {
        toast.error('ERRO', { description: result.message });
        return;
      }
      toast.success(editing ? 'EDITADA' : 'ENVIADA', { description: result.message });
      reset();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!target || !channelId) return;
    setBusy(true);
    try {
      const formData = new FormData();
      formData.set('channelId', channelId);
      formData.set('messageId', target.id);
      const result = await deleteChannelMessageAction(formData);
      if (!result.ok) {
        toast.error('ERRO', { description: result.message });
        return;
      }
      toast.success('APAGADA', { description: result.message });
      if (editing?.id === target.id) reset();
      setTarget(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel title="CANAL.SEL">
        <div className="flex flex-col gap-2">
          <Label htmlFor="canal">Canal</Label>
          <Select
            value={channelId ?? ''}
            onValueChange={(next) => router.push(`/g/${guildId}/mensagens?canal=${next}`)}
          >
            <SelectTrigger id="canal" className="max-w-sm">
              <SelectValue placeholder="Escolha um canal" />
            </SelectTrigger>
            <SelectContent>
              {channels.map((channel) => (
                <SelectItem
                  key={channel.id}
                  value={channel.id}
                  disabled={channel.canSend === false}
                >
                  {`#${channel.name}`}
                  {channel.canSend === false ? ' — o bot não pode falar aqui' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {channels.length === 0 ? (
            <p className="screen-meta">Nenhum canal de texto visível para o bot.</p>
          ) : null}
        </div>
      </Panel>

      <Panel title={editing ? 'EDITAR.MSG' : replyTo ? 'RESPONDER.MSG' : 'NOVA.MSG'}>
        {readOnly ? (
          <p className="border-2 border-base-300 p-3 text-xs">
            ! Você vê o histórico, mas só administradores escrevem por aqui.
          </p>
        ) : null}

        <TemplateEditor
          id="mensagem"
          value={template}
          onChange={setTemplate}
          disabled={!canWrite || busy}
          embedColor={embedColor}
        />

        <div className="flex flex-col gap-2 border-t-2 border-base-300 pt-4">
          <p className="section-label">PODE MENCIONAR</p>
          <p className="text-xs opacity-60">
            Nada é mencionado sem estar marcado aqui, mesmo que o texto tenha @.
          </p>
          <div className="flex flex-wrap gap-4">
            {MENTION_FIELDS.map((field) => (
              <label key={field.key} className="flex items-center gap-2">
                <Checkbox
                  checked={mentions[field.key]}
                  disabled={!canWrite || busy}
                  onCheckedChange={(checked) =>
                    setMentions({ ...mentions, [field.key]: checked === true })
                  }
                />
                <span className="section-label">{field.label}</span>
              </label>
            ))}
          </div>
          {mentions.everyone ? (
            <p className="border-2 border-warning p-3 text-xs text-warning">
              ! @everyone avisa o servidor inteiro. O bot ainda confere se você tem essa permissão
              no Discord.
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t-2 border-base-300 pt-4">
          <p className="screen-meta">
            {editing
              ? `EDITANDO ${editing.id}`
              : replyTo
                ? `RESPONDENDO ${replyTo.author.username}`
                : selected
                  ? `PARA #${selected.name}`
                  : 'SEM CANAL'}
          </p>
          <div className="flex gap-2">
            {(editing ?? replyTo) ? (
              <button
                type="button"
                className="btn-goodchat-outline"
                disabled={busy}
                onClick={reset}
              >
                CANCELAR
              </button>
            ) : null}
            <button
              type="button"
              className="btn-goodchat"
              disabled={!canWrite || busy}
              onClick={() => void submit()}
            >
              {busy ? 'ENVIANDO_' : editing ? 'SALVAR EDIÇÃO' : 'ENVIAR'}
            </button>
          </div>
        </div>
      </Panel>

      <Panel title="RECENTES.LOG">
        {historyError ? (
          <p className="border-2 border-error p-3 text-xs text-error">! {historyError}</p>
        ) : messages.length === 0 ? (
          <p className="screen-meta">Nenhuma mensagem recente neste canal.</p>
        ) : (
          <ul className="flex flex-col">
            {messages.map((message) => (
              <MessageRow
                key={message.id}
                message={message}
                readOnly={readOnly}
                onEdit={startEdit}
                onReply={startReply}
                onDelete={setTarget}
              />
            ))}
          </ul>
        )}
      </Panel>

      <AlertDialog open={target !== null} onOpenChange={(next) => !next && setTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>APAGAR MENSAGEM</AlertDialogTitle>
            <AlertDialogDescription>
              A mensagem some do canal e o conteúdo fica registrado na auditoria. Não dá para
              desfazer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>CANCELAR</AlertDialogCancel>
            <button
              type="button"
              className="btn-goodchat-danger"
              disabled={busy}
              onClick={() => void confirmDelete()}
            >
              {busy ? 'APAGANDO_' : 'CONFIRMAR'}
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
