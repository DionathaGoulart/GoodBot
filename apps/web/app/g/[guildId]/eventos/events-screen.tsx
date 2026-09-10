'use client';

import * as React from 'react';
import {
  EVENT_ENTITY_TYPES,
  EVENT_ENTITY_TYPE_LABEL,
  EVENT_STATUS,
  EVENT_STATUS_LABEL,
  IMAGE_REJECTION_MESSAGE,
  MAX_EVENT_DESCRIPTION_LENGTH,
  MAX_EVENT_LOCATION_LENGTH,
  MAX_EVENT_NAME_LENGTH,
  MAX_GUILD_IMAGE_BYTES,
  parseImageDataUrl,
  scheduledEventProblems,
} from '@goodbot/shared';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { deleteScheduledEventAction, saveScheduledEventAction } from '@/app/actions/guild';
import { DiscordPicker } from '@/components/config/discord-picker';
import { Panel } from '@/components/retro/panel';
import { Tag } from '@/components/retro/tag';
import { EmptyState } from '@/components/retro/states';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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

import type { TagTone } from '@/components/retro/tag';
import type {
  EventEntityType,
  GuildScheduledEventList,
  GuildScheduledEventSummary,
} from '@goodbot/shared';

/** Canais onde um evento do Discord acontece: voz e palco. */
const EVENT_CHANNEL_TYPES = [2, 13];

const STATUS_TONE: Record<number, TagTone> = {
  [EVENT_STATUS.scheduled]: 'accent',
  [EVENT_STATUS.active]: 'success',
  [EVENT_STATUS.completed]: 'muted',
  [EVENT_STATUS.canceled]: 'error',
};

interface Draft {
  eventId: string | null;
  name: string;
  description: string;
  entityType: EventEntityType;
  channelId: string | null;
  location: string;
  scheduledStartAt: string;
  scheduledEndAt: string;
  /** Ausente = não mexer, `null` = remover, data URL = trocar. */
  image: string | null | undefined;
}

const EMPTY: Draft = {
  eventId: null,
  name: '',
  description: '',
  entityType: EVENT_ENTITY_TYPES.voice,
  channelId: null,
  location: '',
  scheduledStartAt: '',
  scheduledEndAt: '',
  image: undefined,
};

/**
 * `datetime-local` fala no fuso do navegador e o Discord fala em UTC. As duas
 * conversões ficam juntas de propósito: separá-las é o jeito clássico de um
 * evento nascer três horas fora do lugar.
 */
function toInputValue(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function toIso(local: string): string {
  if (!local) return '';
  const parsed = new Date(local);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

function toDraft(event: GuildScheduledEventSummary): Draft {
  return {
    eventId: event.id,
    name: event.name,
    description: event.description ?? '',
    entityType: event.entityType as EventEntityType,
    channelId: event.channelId,
    location: event.location ?? '',
    scheduledStartAt: toInputValue(event.scheduledStartAt),
    scheduledEndAt: toInputValue(event.scheduledEndAt),
    image: undefined,
  };
}

function EventCard({
  event,
  readOnly,
  onEdit,
  onDelete,
}: {
  event: GuildScheduledEventSummary;
  readOnly: boolean;
  onEdit: (event: GuildScheduledEventSummary) => void;
  onDelete: (event: GuildScheduledEventSummary) => void;
}) {
  return (
    <li className="flex flex-wrap items-start gap-4 border-b-2 border-base-300 py-4 last:border-b-0">
      <span className="flex h-16 w-28 shrink-0 items-center justify-center border-2 border-base-300">
        {event.coverUrl ? (
          // Capa vem do CDN do Discord; `next/image` pediria host liberado e
          // não ganharia nada num card desse tamanho.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={event.coverUrl} alt="" className="size-full object-cover" />
        ) : (
          <span className="screen-meta">SEM CAPA</span>
        )}
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="flex flex-wrap items-center gap-2">
          <a
            href={event.url}
            target="_blank"
            rel="noreferrer noopener"
            className="font-bold underline decoration-accent decoration-2 underline-offset-4"
          >
            {event.name}
          </a>
          <Tag tone={STATUS_TONE[event.status] ?? 'muted'}>
            {EVENT_STATUS_LABEL[event.status] ?? 'DESCONHECIDO'}
          </Tag>
        </p>
        <p className="screen-meta">
          {new Date(event.scheduledStartAt).toLocaleString('pt-BR')}
          {event.scheduledEndAt
            ? ` → ${new Date(event.scheduledEndAt).toLocaleString('pt-BR')}`
            : ''}
        </p>
        <p className="text-sm opacity-80">
          {event.entityType === EVENT_ENTITY_TYPES.external
            ? (event.location ?? '[sem local]')
            : event.channelName
              ? `#${event.channelName}`
              : '[canal apagado]'}
          {event.userCount === null ? '' : ` · ${String(event.userCount)} interessados`}
        </p>
        {event.description ? (
          <p className="text-sm whitespace-pre-wrap opacity-60">{event.description}</p>
        ) : null}
      </div>

      {readOnly ? null : (
        <div className="flex shrink-0 gap-2">
          <button type="button" className="icon-btn" onClick={() => onEdit(event)}>
            EDITAR
          </button>
          <button type="button" className="icon-btn" onClick={() => onDelete(event)}>
            CANCELAR
          </button>
        </div>
      )}
    </li>
  );
}

/**
 * §6.3 — a tela de eventos. As regras cruzadas (externo exige local e fim) são
 * as mesmas de `scheduledEventProblems`, a função que a rota do bot chama: o
 * que fica vermelho aqui é exatamente o que a API recusaria.
 */
export function EventsScreen({
  list,
  readOnly,
}: {
  list: GuildScheduledEventList;
  readOnly: boolean;
}) {
  const router = useRouter();
  const fileRef = React.useRef<HTMLInputElement>(null);

  const [draft, setDraft] = React.useState<Draft>(EMPTY);
  const [busy, setBusy] = React.useState(false);
  const [target, setTarget] = React.useState<GuildScheduledEventSummary | null>(null);

  const locked = readOnly || !list.canManage;
  const external = draft.entityType === EVENT_ENTITY_TYPES.external;

  const problems = React.useMemo(
    () =>
      scheduledEventProblems({
        entityType: draft.entityType,
        channelId: draft.channelId,
        location: draft.location.trim() || null,
        scheduledStartAt: toIso(draft.scheduledStartAt),
        scheduledEndAt: toIso(draft.scheduledEndAt) || null,
      }),
    [draft],
  );
  const problemOf = (field: string) => problems.find((problem) => problem.field === field)?.message;

  const incomplete = draft.name.trim() === '' || draft.scheduledStartAt === '';
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  function readCover(file: File) {
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
      set('image', url);
    });
    reader.readAsDataURL(file);
  }

  async function submit() {
    if (problems.length > 0 || incomplete) return;
    setBusy(true);
    try {
      const formData = new FormData();
      if (draft.eventId) formData.set('eventId', draft.eventId);
      formData.set(
        'event',
        JSON.stringify({
          name: draft.name,
          description: draft.description,
          entityType: draft.entityType,
          channelId: external ? '' : (draft.channelId ?? ''),
          location: external ? draft.location : '',
          scheduledStartAt: toIso(draft.scheduledStartAt),
          scheduledEndAt: toIso(draft.scheduledEndAt),
          ...(draft.image === undefined ? {} : { image: draft.image }),
        }),
      );
      const result = await saveScheduledEventAction(formData);
      if (!result.ok) {
        toast.error('ERRO', { description: result.message });
        return;
      }
      toast.success(draft.eventId ? 'ATUALIZADO' : 'CRIADO', { description: result.message });
      setDraft(EMPTY);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!target) return;
    setBusy(true);
    try {
      const formData = new FormData();
      formData.set('eventId', target.id);
      const result = await deleteScheduledEventAction(formData);
      if (!result.ok) {
        toast.error('ERRO', { description: result.message });
        return;
      }
      toast.success('CANCELADO', { description: result.message });
      if (draft.eventId === target.id) setDraft(EMPTY);
      setTarget(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {list.canManage ? null : (
        <p className="border-2 border-warning p-3 text-xs text-warning-text">
          ! O bot não tem a permissão Gerenciar Eventos. A lista continua aparecendo, mas criar e
          editar exige reconvidá-lo com ela.
        </p>
      )}

      {locked ? null : (
        <Panel title={draft.eventId ? 'EDITAR.EVT' : 'NOVO.EVT'}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Label htmlFor="event-name">Nome</Label>
              <Input
                id="event-name"
                value={draft.name}
                maxLength={MAX_EVENT_NAME_LENGTH}
                disabled={busy}
                onChange={(event) => set('name', event.target.value)}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="event-type">Onde acontece</Label>
              <Select
                value={String(draft.entityType)}
                disabled={busy}
                onValueChange={(value) => set('entityType', Number(value) as EventEntityType)}
              >
                <SelectTrigger id="event-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(EVENT_ENTITY_TYPES).map((type) => (
                    <SelectItem key={type} value={String(type)}>
                      {EVENT_ENTITY_TYPE_LABEL[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {external ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="event-location">Local</Label>
                <Input
                  id="event-location"
                  value={draft.location}
                  maxLength={MAX_EVENT_LOCATION_LENGTH}
                  placeholder="Endereço, link, o que for"
                  disabled={busy}
                  onChange={(event) => set('location', event.target.value)}
                />
                {problemOf('location') ? (
                  <p className="text-xs text-error-text">! {problemOf('location')}</p>
                ) : null}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <Label htmlFor="event-channel">Canal</Label>
                <DiscordPicker
                  id="event-channel"
                  kind="channel"
                  channelTypes={EVENT_CHANNEL_TYPES}
                  value={draft.channelId ? [draft.channelId] : []}
                  onChange={(next) => set('channelId', next[0] ?? null)}
                  disabled={busy}
                />
                {problemOf('channelId') ? (
                  <p className="text-xs text-error-text">! {problemOf('channelId')}</p>
                ) : null}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Label htmlFor="event-start">Início</Label>
              <Input
                id="event-start"
                type="datetime-local"
                value={draft.scheduledStartAt}
                disabled={busy}
                onChange={(event) => set('scheduledStartAt', event.target.value)}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="event-end">Fim{external ? '' : ' (opcional)'}</Label>
              <Input
                id="event-end"
                type="datetime-local"
                value={draft.scheduledEndAt}
                disabled={busy}
                onChange={(event) => set('scheduledEndAt', event.target.value)}
              />
              {problemOf('scheduledEndAt') ? (
                <p className="text-xs text-error-text">! {problemOf('scheduledEndAt')}</p>
              ) : null}
            </div>

            <div className="flex flex-col gap-2 sm:col-span-2">
              <Label htmlFor="event-description">Descrição</Label>
              <Textarea
                id="event-description"
                rows={3}
                value={draft.description}
                maxLength={MAX_EVENT_DESCRIPTION_LENGTH}
                disabled={busy}
                onChange={(event) => set('description', event.target.value)}
              />
            </div>

            <div className="flex flex-col gap-2 sm:col-span-2">
              <Label>Capa</Label>
              <div className="flex flex-wrap items-center gap-4">
                <span className="flex h-20 w-40 items-center justify-center border-2 border-base-300">
                  {draft.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={draft.image} alt="" className="size-full object-cover" />
                  ) : (
                    <span className="screen-meta">SEM CAPA</span>
                  )}
                </span>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) readCover(file);
                    event.target.value = '';
                  }}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="icon-btn"
                    disabled={busy}
                    onClick={() => fileRef.current?.click()}
                  >
                    ESCOLHER
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    disabled={busy || draft.image === null}
                    onClick={() => set('image', null)}
                  >
                    REMOVER
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t-2 border-base-300 pt-4">
            <p className="screen-meta">
              {draft.eventId ? `EDITANDO ${draft.eventId}` : 'NOVO EVENTO'}
            </p>
            <div className="flex gap-2">
              {draft.eventId ? (
                <button
                  type="button"
                  className="btn-goodchat-outline"
                  disabled={busy}
                  onClick={() => setDraft(EMPTY)}
                >
                  CANCELAR
                </button>
              ) : null}
              <button
                type="button"
                className="btn-goodchat"
                disabled={busy || incomplete || problems.length > 0}
                onClick={() => void submit()}
              >
                {busy ? 'SALVANDO_' : draft.eventId ? 'SALVAR' : 'AGENDAR'}
              </button>
            </div>
          </div>
        </Panel>
      )}

      <Panel title="EVENTOS.LST">
        {list.events.length === 0 ? (
          <EmptyState description="Nenhum evento agendado neste servidor." />
        ) : (
          <ul className="flex flex-col">
            {list.events.map((event) => (
              <EventCard
                key={event.id}
                event={event}
                readOnly={locked}
                onEdit={(chosen) => setDraft(toDraft(chosen))}
                onDelete={setTarget}
              />
            ))}
          </ul>
        )}
      </Panel>

      <AlertDialog open={target !== null} onOpenChange={(next) => !next && setTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>CANCELAR EVENTO</AlertDialogTitle>
            <AlertDialogDescription>
              {target
                ? `"${target.name}" some do servidor e quem marcou interesse deixa de ser avisado. Não dá para desfazer.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>VOLTAR</AlertDialogCancel>
            <button
              type="button"
              className="btn-goodchat-danger"
              disabled={busy}
              onClick={() => void confirmDelete()}
            >
              {busy ? 'CANCELANDO_' : 'CONFIRMAR'}
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
