'use client';

import * as React from 'react';
import { SQUAD_CELLS, type SquadBlockConfig, type SquadGameField } from '@goodbot/shared';

import {
  deletePlayerProfileAction,
  removePlayerFromSquadAction,
  setPlayerStatusAction,
} from '@/app/actions/squads';
import { AvatarSq } from '@/components/retro/avatar-sq';
import { Tag } from '@/components/retro/tag';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  formatDate,
  formatDateTime,
  SQUAD_PROFILE_STATUS_LABEL,
  SQUAD_STATUS_LABEL,
} from '@/lib/squad-labels';
import { useGuildId } from '@/lib/use-guild-id';

import { withPayload } from './form-data';
import { PlayerAnswersForm } from './player-answers-form';
import { PLAYER_STATUS_TONE } from './players-table';
import { ReasonDialog, type ReasonRequest } from './reason-dialog';
import { SquadGridHeatmap } from './squad-grid-heatmap';

import type { PlayerRow, SquadPlayersData } from '@/lib/squad-players';
import type { SquadGameRow } from '@/lib/squads';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="section-label">{title}</h3>
      {children}
    </section>
  );
}

function answerText(field: SquadGameField, player: PlayerRow): string | null {
  const value = Object.hasOwn(player.answers, field.key) ? player.answers[field.key] : undefined;
  const text = Array.isArray(value) ? value.join(', ') : (value ?? '');
  return text.trim() === '' ? null : text;
}

/** O motivo de não dar para apagar o perfil agora; `null` quando dá. */
function deleteBlocker(player: PlayerRow): string | null {
  if (player.inSquadInGame) return 'EM SQUAD DESTE JOGO: TIRE DO SQUAD ANTES DE APAGAR';
  if (player.openProposalIds.length > 0) return 'EM PROPOSTA ABERTA: ESPERE ELA FECHAR OU EXPIRAR';
  if (player.pendingRequestSquadIds.length > 0) return 'COM CONVITE OU PEDIDO DE ENTRADA ABERTO';
  return null;
}

/**
 * O perfil completo de uma pessoa: respostas, grade, squads, propostas e
 * pedidos deste jogo, com as ações de gestão. Toda ação passa pelo bot e pede
 * o motivo antes, porque a pessoa recebe uma DM com ele.
 */
export function PlayerSheet({
  player,
  game,
  data,
  blocks,
  timeZone,
  onClose,
  onChanged,
}: {
  player: PlayerRow | null;
  game: SquadGameRow | null;
  data: SquadPlayersData;
  blocks: SquadBlockConfig[];
  timeZone: string;
  onClose: () => void;
  /** Alguma ação deu certo: a página recarrega os dados. */
  onChanged: () => void;
}) {
  const guildId = useGuildId();
  const [editing, setEditing] = React.useState(false);
  const [request, setRequest] = React.useState<ReasonRequest | null>(null);

  // Trocar de pessoa fecha a edição, ajustado no render para o formulário da
  // anterior não aparecer nem por um quadro.
  const [shownUserId, setShownUserId] = React.useState(player?.userId);
  if (player?.userId !== shownUserId) {
    setShownUserId(player?.userId);
    setEditing(false);
  }

  const squads = React.useMemo(
    () =>
      player
        ? data.liveSquads.filter((squad) => player.squadIds.includes(squad.id))
        : [],
    [data.liveSquads, player],
  );
  const proposals = React.useMemo(
    () =>
      player ? data.openProposals.filter((proposal) => player.openProposalIds.includes(proposal.id)) : [],
    [data.openProposals, player],
  );
  const requests = React.useMemo(
    () =>
      player
        ? data.pendingRequests.filter(
            (entry) =>
              entry.userId === player.userId && player.pendingRequestSquadIds.includes(entry.squadId),
          )
        : [],
    [data.pendingRequests, player],
  );
  const squadName = (squadId: string) =>
    data.liveSquads.find((squad) => squad.id === squadId)?.name ?? 'Squad';

  const grid = React.useMemo(
    () =>
      Array.from({ length: SQUAD_CELLS }, (_, bit) => ((player?.availability ?? 0) >> bit) & 1),
    [player?.availability],
  );

  if (!player || !game) {
    return (
      <Sheet open={false}>
        <SheetContent className="w-full sm:max-w-lg" />
      </Sheet>
    );
  }

  const name = player.name.toUpperCase();
  const memberOfSquad = player.squadIds.length > 0;
  const blocker = deleteBlocker(player);
  const profileAction = (extra: Record<string, unknown>) => (reason: string) =>
    extra.status
      ? setPlayerStatusAction(
          guildId,
          withPayload({ gameId: game.id, userId: player.userId, ...extra, reason }),
        )
      : deletePlayerProfileAction(
          guildId,
          withPayload({ gameId: game.id, userId: player.userId, reason }),
        );

  return (
    <>
      <Sheet open onOpenChange={(open) => !open && onClose()}>
        <SheetContent className="w-full sm:max-w-lg">
          <SheetHeader>
            <div className="flex items-center gap-3">
              <AvatarSq src={player.avatarUrl} name={player.name} size={32} />
              <div className="flex min-w-0 flex-col gap-1">
                <SheetTitle>{player.name}</SheetTitle>
                <SheetDescription>
                  {player.inGuild === false
                    ? '[SAIU DO SERVIDOR]'
                    : player.username
                      ? `@${player.username}`
                      : 'NOME INDISPONÍVEL'}
                </SheetDescription>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Tag tone={PLAYER_STATUS_TONE[player.status]}>
                {SQUAD_PROFILE_STATUS_LABEL[player.status]}
              </Tag>
              <span className="screen-meta select-all">{player.userId}</span>
            </div>
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 pb-6">
            <Section title="RESPOSTAS">
              {editing ? (
                <PlayerAnswersForm
                  gameId={game.id}
                  userId={player.userId}
                  fields={game.fields}
                  answers={player.answers}
                  onCancel={() => setEditing(false)}
                  onSaved={() => {
                    setEditing(false);
                    onChanged();
                  }}
                />
              ) : (
                <>
                  {game.fields.length === 0 ? (
                    <p className="screen-meta">ESTE JOGO NÃO TEM PERGUNTAS</p>
                  ) : (
                    <dl className="flex flex-col gap-2">
                      {game.fields.map((field) => (
                        <div key={field.key} className="flex flex-col">
                          <dt className="screen-meta">{field.label.toUpperCase()}</dt>
                          <dd className="text-sm">
                            {answerText(field, player) ?? (
                              <span className="text-muted-text">SEM RESPOSTA</span>
                            )}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {game.fields.length > 0 ? (
                    <button
                      type="button"
                      className="icon-btn self-start"
                      onClick={() => setEditing(true)}
                    >
                      EDITAR
                    </button>
                  ) : null}
                </>
              )}
            </Section>

            <Section title="GRADE">
              <SquadGridHeatmap grid={grid} blocks={blocks} mode="mask" />
            </Section>

            <Section title="SQUADS">
              {squads.length === 0 ? (
                <p className="screen-meta">EM NENHUM SQUAD DESTE JOGO</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {squads.map((squad) => (
                    <li key={squad.id} className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex flex-col">
                        <span className="font-bold">{squad.name}</span>
                        <span className="screen-meta">
                          {squad.memberIds.length}{' '}
                          {squad.memberIds.length === 1 ? 'MEMBRO' : 'MEMBROS'} ·{' '}
                          {SQUAD_STATUS_LABEL[squad.status]}
                        </span>
                      </span>
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() =>
                          setRequest({
                            title: `TIRAR ${name} DO SQUAD ${squad.name.toUpperCase()}?`,
                            description:
                              'O canal do squad fica sabendo que foi a staff, sem o motivo. A pessoa recebe uma DM com ele.',
                            danger: true,
                            onConfirm: (reason) =>
                              removePlayerFromSquadAction(
                                guildId,
                                withPayload({ squadId: squad.id, userId: player.userId, reason }),
                              ),
                            onDone: onChanged,
                          })
                        }
                      >
                        REMOVER
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="screen-meta">
                EM {player.activeSquadCount}{' '}
                {player.activeSquadCount === 1 ? 'SQUAD' : 'SQUADS'} NO SERVIDOR
              </p>
            </Section>

            <Section title="PROPOSTAS ABERTAS">
              {proposals.length === 0 ? (
                <p className="screen-meta">NENHUMA</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {proposals.map((proposal) => (
                    <li key={proposal.id} className="screen-meta">
                      TURMA DE {proposal.userIds.length} · {proposal.acceptedIds.length} ACEITARAM ·
                      EXPIRA {formatDateTime(proposal.expiresAt, timeZone)}
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="CONVITES E PEDIDOS">
              {requests.length === 0 ? (
                <p className="screen-meta">NENHUM</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {requests.map((entry) => (
                    <li key={entry.id} className="screen-meta">
                      {squadName(entry.squadId).toUpperCase()} ·{' '}
                      {entry.status === 'invited' ? 'CONVITE SEM RESPOSTA' : 'EM VOTAÇÃO NO SQUAD'} · DESDE{' '}
                      {formatDate(entry.createdAt, timeZone)}
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="AÇÕES">
              <div className="flex flex-wrap gap-2">
                {memberOfSquad ? null : player.status === 'paused' ? (
                  <button
                    type="button"
                    className="btn-goodchat-outline"
                    onClick={() =>
                      setRequest({
                        title: `RETOMAR A BUSCA DE ${name}?`,
                        description:
                          'A pessoa recebe uma DM com este motivo e volta para o match na hora.',
                        onConfirm: profileAction({ status: 'searching' }),
                        onDone: onChanged,
                      })
                    }
                  >
                    VOLTAR A PROCURAR
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn-goodchat-outline"
                    onClick={() =>
                      setRequest({
                        title: `PAUSAR A BUSCA DE ${name}?`,
                        onConfirm: profileAction({ status: 'paused' }),
                        onDone: onChanged,
                      })
                    }
                  >
                    PAUSAR
                  </button>
                )}
                <button
                  type="button"
                  className="btn-goodchat-danger"
                  disabled={blocker !== null}
                  aria-describedby={blocker ? 'delete-profile-blocker' : undefined}
                  onClick={() =>
                    setRequest({
                      title: `APAGAR O PERFIL DE ${name}?`,
                      description:
                        'Respostas e horários somem, e a pessoa sai da busca deste jogo. Ela recebe uma DM com este motivo.',
                      danger: true,
                      onConfirm: profileAction({}),
                      onDone: () => {
                        onChanged();
                        onClose();
                      },
                    })
                  }
                >
                  APAGAR PERFIL
                </button>
              </div>
              {memberOfSquad ? (
                <p className="screen-meta">EM SQUAD: SÓ O BOT MUDA ESTE STATUS</p>
              ) : null}
              {blocker ? (
                <p id="delete-profile-blocker" className="screen-meta">
                  {blocker}
                </p>
              ) : null}
            </Section>
          </div>
        </SheetContent>
      </Sheet>

      <ReasonDialog request={request} onClose={() => setRequest(null)} />
    </>
  );
}
