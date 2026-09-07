'use client';

import * as React from 'react';
import {
  EmojiNameSchema,
  IMAGE_REJECTION_MESSAGE,
  MAX_EMOJI_BYTES,
  MAX_EMOJI_NAME_LENGTH,
  MAX_STICKER_BYTES,
  MAX_STICKER_DESCRIPTION_LENGTH,
  MAX_STICKER_NAME_LENGTH,
  MAX_STICKER_TAGS_LENGTH,
  EMOJI_MIME_TYPES,
  STICKER_MIME_TYPES,
  emojiSlotState,
  parseImageDataUrl,
  stickerSlotState,
} from '@cobot/shared';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import {
  createEmojiAction,
  createStickerAction,
  deleteEmojiAction,
  deleteStickerAction,
  updateEmojiAction,
  updateStickerAction,
} from '@/app/actions/guild';
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

import type {
  ExpressionOverview,
  GuildEmojiSummary,
  GuildStickerSummary,
  SlotState,
} from '@cobot/shared';

/** O que está aberto para apagar; `kind` decide qual action é chamada. */
type DeleteTarget =
  | { kind: 'emoji'; item: GuildEmojiSummary }
  | { kind: 'sticker'; item: GuildStickerSummary };

function SlotLine({ label, state }: { label: string; state: SlotState }) {
  return (
    <p className="screen-meta">
      {label}: {String(state.used)}/{String(state.limit)}
      {state.full ? ' · CHEIO' : ` · ${String(state.remaining)} LIVRES`}
    </p>
  );
}

/** Lê um arquivo como data URL, recusando aqui o que a API recusaria. */
function readImage(
  file: File,
  limits: { mimeTypes: string[]; maxBytes: number },
  onDone: (dataUrl: string) => void,
): void {
  if (file.size > limits.maxBytes) {
    toast.error('ERRO', { description: IMAGE_REJECTION_MESSAGE.size });
    return;
  }
  const reader = new FileReader();
  reader.addEventListener('load', () => {
    const url = String(reader.result);
    const parsed = parseImageDataUrl(url, limits);
    if (!parsed.ok) {
      toast.error('ERRO', { description: IMAGE_REJECTION_MESSAGE[parsed.reason] });
      return;
    }
    onDone(url);
  });
  reader.readAsDataURL(file);
}

/**
 * §6.3 — emojis em grade com preview de 48px e stickers em lista. Os slots
 * aparecem em cima porque a recusa por cota cheia é a coisa mais comum de
 * acontecer aqui, e ela é bem mais fácil de entender antes do upload.
 */
export function ExpressionsScreen({
  overview,
  readOnly,
}: {
  overview: ExpressionOverview;
  readOnly: boolean;
}) {
  const router = useRouter();
  const emojiFileRef = React.useRef<HTMLInputElement>(null);
  const stickerFileRef = React.useRef<HTMLInputElement>(null);

  const [busy, setBusy] = React.useState(false);
  const [target, setTarget] = React.useState<DeleteTarget | null>(null);

  const [emojiName, setEmojiName] = React.useState('');
  const [emojiImage, setEmojiImage] = React.useState<string | null>(null);
  const [emojiRoles, setEmojiRoles] = React.useState<string[]>([]);
  const [editingEmoji, setEditingEmoji] = React.useState<GuildEmojiSummary | null>(null);

  const [stickerName, setStickerName] = React.useState('');
  const [stickerTags, setStickerTags] = React.useState('');
  const [stickerDescription, setStickerDescription] = React.useState('');
  const [stickerImage, setStickerImage] = React.useState<string | null>(null);
  const [editingSticker, setEditingSticker] = React.useState<GuildStickerSummary | null>(null);

  const locked = readOnly || !overview.canManage;

  const staticSlots = emojiSlotState(overview.limits, false);
  const animatedSlots = emojiSlotState(overview.limits, true);
  const stickerSlots = stickerSlotState(overview.limits);

  const emojiAnimated = emojiImage?.startsWith('data:image/gif;') ?? false;
  const emojiNameOk = EmojiNameSchema.safeParse(emojiName).success;
  const targetSlots = emojiAnimated ? animatedSlots : staticSlots;

  function resetEmoji() {
    setEditingEmoji(null);
    setEmojiName('');
    setEmojiImage(null);
    setEmojiRoles([]);
  }

  function resetSticker() {
    setEditingSticker(null);
    setStickerName('');
    setStickerTags('');
    setStickerDescription('');
    setStickerImage(null);
  }

  function startEmojiEdit(emoji: GuildEmojiSummary) {
    setEditingEmoji(emoji);
    setEmojiName(emoji.name);
    setEmojiImage(null);
    setEmojiRoles(emoji.roleIds);
  }

  function startStickerEdit(sticker: GuildStickerSummary) {
    setEditingSticker(sticker);
    setStickerName(sticker.name);
    setStickerTags(sticker.tags ?? '');
    setStickerDescription(sticker.description ?? '');
    setStickerImage(null);
  }

  async function run(action: () => Promise<{ ok: boolean; message?: string }>, title: string) {
    setBusy(true);
    try {
      const result = await action();
      if (!result.ok) {
        toast.error('ERRO', { description: result.message });
        return false;
      }
      toast.success(title, { description: result.message });
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function submitEmoji() {
    const formData = new FormData();
    if (editingEmoji) {
      formData.set('emojiId', editingEmoji.id);
      formData.set('emoji', JSON.stringify({ name: emojiName, roleIds: emojiRoles }));
      if (await run(() => updateEmojiAction(formData), 'ATUALIZADO')) resetEmoji();
      return;
    }
    if (!emojiImage) return;
    formData.set(
      'emoji',
      JSON.stringify({ name: emojiName, image: emojiImage, roleIds: emojiRoles }),
    );
    if (await run(() => createEmojiAction(formData), 'CRIADO')) resetEmoji();
  }

  async function submitSticker() {
    const formData = new FormData();
    const body = {
      name: stickerName,
      tags: stickerTags,
      description: stickerDescription,
    };
    if (editingSticker) {
      formData.set('stickerId', editingSticker.id);
      formData.set('sticker', JSON.stringify(body));
      if (await run(() => updateStickerAction(formData), 'ATUALIZADO')) resetSticker();
      return;
    }
    if (!stickerImage) return;
    formData.set('sticker', JSON.stringify({ ...body, image: stickerImage }));
    if (await run(() => createStickerAction(formData), 'CRIADO')) resetSticker();
  }

  async function confirmDelete() {
    if (!target) return;
    const formData = new FormData();
    if (target.kind === 'emoji') {
      formData.set('emojiId', target.item.id);
      if (await run(() => deleteEmojiAction(formData), 'APAGADO')) setTarget(null);
      return;
    }
    formData.set('stickerId', target.item.id);
    if (await run(() => deleteStickerAction(formData), 'APAGADO')) setTarget(null);
  }

  return (
    <div className="flex flex-col gap-4">
      {overview.canManage ? null : (
        <p className="border-2 border-warning p-3 text-xs text-warning-text">
          ! O bot não tem a permissão Gerenciar Expressões. A lista continua aparecendo, mas subir,
          renomear e apagar exige reconvidá-lo com ela.
        </p>
      )}

      <Panel title="SLOTS.CFG">
        <div className="grid gap-2 sm:grid-cols-3">
          <SlotLine label="EMOJIS ESTÁTICOS" state={staticSlots} />
          <SlotLine label="EMOJIS ANIMADOS" state={animatedSlots} />
          <SlotLine label="STICKERS" state={stickerSlots} />
        </div>
        <p className="text-xs opacity-60">
          O Discord conta emoji estático e animado em cotas separadas. Cada nível de impulso abre
          mais slots nas duas.
        </p>
      </Panel>

      {locked ? null : (
        <Panel title={editingEmoji ? 'EDITAR.EMOJI' : 'NOVO.EMOJI'}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="emoji-name">Nome</Label>
              <Input
                id="emoji-name"
                value={emojiName}
                maxLength={MAX_EMOJI_NAME_LENGTH}
                placeholder="cobot_ok"
                disabled={busy}
                onChange={(event) => setEmojiName(event.target.value)}
              />
              {emojiName && !emojiNameOk ? (
                <p className="text-xs text-error-text">! Use só letras, números e _.</p>
              ) : null}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="emoji-roles">Cargos que enxergam</Label>
              <DiscordPicker
                id="emoji-roles"
                kind="role"
                multiple
                value={emojiRoles}
                onChange={setEmojiRoles}
                disabled={busy}
                placeholder="Todo mundo"
              />
            </div>

            {editingEmoji ? null : (
              <div className="flex flex-col gap-2 sm:col-span-2">
                <Label>Imagem</Label>
                <div className="flex flex-wrap items-center gap-4">
                  <span className="flex size-16 items-center justify-center border-2 border-base-300">
                    {emojiImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={emojiImage} alt="" className="size-12 object-contain" />
                    ) : (
                      <span className="screen-meta">VAZIO</span>
                    )}
                  </span>
                  <input
                    ref={emojiFileRef}
                    type="file"
                    accept={EMOJI_MIME_TYPES.join(',')}
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) {
                        readImage(
                          file,
                          { mimeTypes: EMOJI_MIME_TYPES, maxBytes: MAX_EMOJI_BYTES },
                          setEmojiImage,
                        );
                      }
                      event.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    className="icon-btn"
                    disabled={busy}
                    onClick={() => emojiFileRef.current?.click()}
                  >
                    ESCOLHER
                  </button>
                  <span className="screen-meta">PNG, JPEG, GIF OU WEBP · ATÉ 256 KB</span>
                </div>
                {emojiImage && targetSlots.full ? (
                  <p className="border-2 border-error p-3 text-xs text-error-text">
                    ! Os {String(targetSlots.limit)} slots de emojis{' '}
                    {emojiAnimated ? 'animados' : 'estáticos'} estão cheios. Apague um antes de
                    subir este.
                  </p>
                ) : null}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t-2 border-base-300 pt-4">
            <p className="screen-meta">
              {editingEmoji ? `EDITANDO :${editingEmoji.name}:` : 'NOVO EMOJI'}
            </p>
            <div className="flex gap-2">
              {editingEmoji ? (
                <button
                  type="button"
                  className="btn-goodchat-outline"
                  disabled={busy}
                  onClick={resetEmoji}
                >
                  CANCELAR
                </button>
              ) : null}
              <button
                type="button"
                className="btn-goodchat"
                disabled={
                  busy ||
                  !emojiNameOk ||
                  (!editingEmoji && (!emojiImage || targetSlots.full))
                }
                onClick={() => void submitEmoji()}
              >
                {busy ? 'SALVANDO_' : editingEmoji ? 'SALVAR' : 'SUBIR EMOJI'}
              </button>
            </div>
          </div>
        </Panel>
      )}

      <Panel title="EMOJIS.LST">
        {overview.emojis.length === 0 ? (
          <EmptyState description="Nenhum emoji neste servidor." />
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {overview.emojis.map((emoji) => (
              <li
                key={emoji.id}
                className="flex items-center gap-3 border-2 border-base-300 bg-base-200 p-3"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={emoji.url} alt={emoji.name} className="size-12 shrink-0 object-contain" />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p className="truncate text-sm font-bold">:{emoji.name}:</p>
                  <p className="flex flex-wrap gap-1">
                    {emoji.animated ? <Tag tone="info">ANIMADO</Tag> : null}
                    {emoji.managed ? <Tag tone="muted">INTEGRAÇÃO</Tag> : null}
                    {emoji.available ? null : <Tag tone="warning">INDISPONÍVEL</Tag>}
                    {emoji.roleIds.length > 0 ? (
                      <Tag tone="accent">{String(emoji.roleIds.length)} CARGOS</Tag>
                    ) : null}
                  </p>
                </div>
                {locked || emoji.managed ? null : (
                  <div className="flex shrink-0 flex-col gap-1">
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => startEmojiEdit(emoji)}
                    >
                      EDITAR
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => setTarget({ kind: 'emoji', item: emoji })}
                    >
                      APAGAR
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {locked ? null : (
        <Panel title={editingSticker ? 'EDITAR.STK' : 'NOVO.STK'}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="sticker-name">Nome</Label>
              <Input
                id="sticker-name"
                value={stickerName}
                maxLength={MAX_STICKER_NAME_LENGTH}
                disabled={busy}
                onChange={(event) => setStickerName(event.target.value)}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="sticker-tags">Emoji relacionado</Label>
              <Input
                id="sticker-tags"
                value={stickerTags}
                maxLength={MAX_STICKER_TAGS_LENGTH}
                placeholder="😄"
                disabled={busy}
                onChange={(event) => setStickerTags(event.target.value)}
              />
              <p className="text-xs opacity-60">
                O Discord exige um emoji para achar o sticker na busca.
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:col-span-2">
              <Label htmlFor="sticker-description">Descrição</Label>
              <Input
                id="sticker-description"
                value={stickerDescription}
                maxLength={MAX_STICKER_DESCRIPTION_LENGTH}
                disabled={busy}
                onChange={(event) => setStickerDescription(event.target.value)}
              />
            </div>

            {editingSticker ? null : (
              <div className="flex flex-col gap-2 sm:col-span-2">
                <Label>Imagem</Label>
                <div className="flex flex-wrap items-center gap-4">
                  <span className="flex size-20 items-center justify-center border-2 border-base-300">
                    {stickerImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={stickerImage} alt="" className="size-16 object-contain" />
                    ) : (
                      <span className="screen-meta">VAZIO</span>
                    )}
                  </span>
                  <input
                    ref={stickerFileRef}
                    type="file"
                    accept={STICKER_MIME_TYPES.join(',')}
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) {
                        readImage(
                          file,
                          { mimeTypes: STICKER_MIME_TYPES, maxBytes: MAX_STICKER_BYTES },
                          setStickerImage,
                        );
                      }
                      event.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    className="icon-btn"
                    disabled={busy}
                    onClick={() => stickerFileRef.current?.click()}
                  >
                    ESCOLHER
                  </button>
                  <span className="screen-meta">PNG OU GIF · ATÉ 512 KB</span>
                </div>
                {stickerImage && stickerSlots.full ? (
                  <p className="border-2 border-error p-3 text-xs text-error-text">
                    ! Os {String(stickerSlots.limit)} slots de stickers estão cheios. Apague um
                    antes de subir este.
                  </p>
                ) : null}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t-2 border-base-300 pt-4">
            <p className="screen-meta">
              {editingSticker ? `EDITANDO ${editingSticker.name}` : 'NOVO STICKER'}
            </p>
            <div className="flex gap-2">
              {editingSticker ? (
                <button
                  type="button"
                  className="btn-goodchat-outline"
                  disabled={busy}
                  onClick={resetSticker}
                >
                  CANCELAR
                </button>
              ) : null}
              <button
                type="button"
                className="btn-goodchat"
                disabled={
                  busy ||
                  stickerName.trim().length < 2 ||
                  stickerTags.trim() === '' ||
                  (!editingSticker && (!stickerImage || stickerSlots.full))
                }
                onClick={() => void submitSticker()}
              >
                {busy ? 'SALVANDO_' : editingSticker ? 'SALVAR' : 'SUBIR STICKER'}
              </button>
            </div>
          </div>
        </Panel>
      )}

      <Panel title="STICKERS.LST">
        {overview.stickers.length === 0 ? (
          <EmptyState description="Nenhum sticker neste servidor." />
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {overview.stickers.map((sticker) => (
              <li
                key={sticker.id}
                className="flex items-center gap-3 border-2 border-base-300 bg-base-200 p-3"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={sticker.url}
                  alt={sticker.name}
                  className="size-16 shrink-0 object-contain"
                />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p className="truncate text-sm font-bold">{sticker.name}</p>
                  <p className="truncate text-xs opacity-60">
                    {sticker.description ?? '[sem descrição]'}
                  </p>
                  {sticker.tags ? <p className="screen-meta">{sticker.tags}</p> : null}
                </div>
                {locked ? null : (
                  <div className="flex shrink-0 flex-col gap-1">
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => startStickerEdit(sticker)}
                    >
                      EDITAR
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => setTarget({ kind: 'sticker', item: sticker })}
                    >
                      APAGAR
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <AlertDialog open={target !== null} onOpenChange={(next) => !next && setTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {target?.kind === 'sticker' ? 'APAGAR STICKER' : 'APAGAR EMOJI'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {target
                ? `"${target.item.name}" some do servidor e as mensagens que o usaram ficam sem ele. Não dá para desfazer.`
                : ''}
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
