'use client';

import { useFormContext } from 'react-hook-form';

import { publishSquadGuidesAction } from '@/app/actions/squads';
import { ActionButton } from '@/components/config/confirm-button';
import { ConfigForm } from '@/components/config/config-form';
import { CHANNEL_TYPES } from '@/components/config/discord-options';
import { DiscordField, NumberField } from '@/components/config/fields';
import { ModuleToggle } from '@/components/config/module-toggle';
import { Panel } from '@/components/retro/panel';
import { useGuildId } from '@/lib/use-guild-id';

import type { SquadsConfig } from '@goodbot/shared';

interface PublishedMessage {
  channelId: string;
  messageId: string;
}

/** As três mensagens do bot, como a página as leu do config salvo. */
export interface PublishedGuides {
  chatGuide: PublishedMessage | null;
  deskGuide: PublishedMessage | null;
  deskButtons: PublishedMessage | null;
}

const GUIDE_LABELS: Record<keyof PublishedGuides, string> = {
  chatGuide: 'GUIA DO BUSCAR SQUAD',
  deskGuide: 'GUIA DO JOGATINAS',
  deskButtons: 'BOTÕES DO JOGATINAS',
};

/** Só os canais de texto comuns: a agenda abre thread e o bot fixa o guia. */
const TEXT_ONLY = [CHANNEL_TYPES.text];

/**
 * Os guias e os botões. Quem publica é o bot, com o config **salvo**: com o
 * formulário sujo o botão espera, senão a staff trocaria o canal, clicaria e
 * veria a mensagem sair no canal antigo.
 */
function GuideMessages({ published, readOnly }: { published: PublishedGuides; readOnly: boolean }) {
  const guildId = useGuildId();
  const dirty = useFormContext<SquadsConfig>().formState.isDirty;
  const any = Object.values(published).some((message) => message !== null);

  return (
    <Panel
      title="GUIAS.MSG"
      actions={
        readOnly ? null : (
          <ActionButton
            label={any ? 'ATUALIZAR GUIAS' : 'PUBLICAR GUIAS'}
            busyLabel="PUBLICANDO_"
            successTitle={any ? 'ATUALIZADO' : 'PUBLICADO'}
            disabled={dirty}
            action={() => publishSquadGuidesAction(guildId)}
          />
        )
      }
    >
      <p className="text-sm">
        Três mensagens do bot: o guia fixado no canal de buscar squad, e o guia e os botões PROCURAR
        AGORA, MARCAR JOGATINA, MINHAS JOGATINAS e ME AVISA no canal de jogatinas. O bot também
        republica sozinho a que for apagada e reedita as do ar quando o texto muda.
      </p>
      <ul className="screen-meta">
        {(Object.keys(GUIDE_LABELS) as (keyof PublishedGuides)[]).map((key) => {
          const message = published[key];
          return (
            <li key={key}>
              {GUIDE_LABELS[key]} ·{' '}
              {message ? (
                <a
                  href={`https://discord.com/channels/${guildId}/${message.channelId}/${message.messageId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  NO AR
                </a>
              ) : (
                'NÃO PUBLICADO'
              )}
            </li>
          );
        })}
      </ul>
      {dirty && !readOnly ? (
        <p className="screen-meta">SALVE ANTES DE PUBLICAR: O BOT USA O CONFIG SALVO</p>
      ) : null}
    </Panel>
  );
}

export function SquadsConfigForm({
  values,
  published,
  readOnly,
}: {
  values: SquadsConfig;
  published: PublishedGuides;
  readOnly: boolean;
}) {
  return (
    <ConfigForm page="squads" defaultValues={values} readOnly={readOnly}>
      <ModuleToggle description="Quem quer jogar agora publica um card com sala de voz na hora; quem quer marcar para depois põe a jogatina na agenda. Desligado, o bot para de reagir; salas, cargo e mensagens que já existem ficam como estão." />

      <GuideMessages published={published} readOnly={readOnly} />

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="CANAIS.CFG">
          <p className="text-sm">
            Três canais de texto diferentes, criados pela staff. Sem um deles, só a ação que precisa
            dele recusa.
          </p>
          <DiscordField
            name="chatChannelId"
            kind="channel"
            channelTypes={TEXT_ONLY}
            label="Canal de buscar squad"
            description="Chat livre de todo mundo. O bot fixa o guia e posta ali os cards de quem quer jogar agora."
            placeholder="Nenhum canal"
          />
          <DiscordField
            name="deskChannelId"
            kind="channel"
            channelTypes={TEXT_ONLY}
            label="Canal de jogatinas"
            description="Só o bot escreve: o guia e a mensagem dos botões. É o lugar de quem não lembra o comando."
            placeholder="Nenhum canal"
          />
          <DiscordField
            name="agendaChannelId"
            kind="channel"
            channelTypes={TEXT_ONLY}
            label="Canal da agenda"
            description="Só o bot escreve: cada jogatina marcada vira uma mensagem com a lista de quem vai e uma thread. Threads liberadas."
            placeholder="Nenhum canal"
          />
        </Panel>

        <Panel title="SALAS.CFG">
          <DiscordField
            name="categoryId"
            kind="channel"
            channelTypes={[CHANNEL_TYPES.category]}
            label="Categoria das salas"
            description="É do módulo: voz aqui com nome Squad Alfa, Squad Beta... é apagado quando esvazia."
            placeholder="Nenhuma categoria"
          />
          <NumberField
            name="roomSize"
            label="Vagas padrão"
            description="Quantas vagas o card e a jogatina têm quando ninguém diz, e o limite de gente na sala."
            min={2}
            max={10}
            suffix="PESSOAS"
          />
          <NumberField
            name="graceMinutes"
            label="Janela de tolerância"
            description="A sala vazia só some depois disso. Cobre queda de conexão. 0 é na hora."
            min={0}
            max={10}
            suffix="MIN"
          />
        </Panel>

        <Panel title="AVISO.CFG">
          <p className="text-sm">
            Cargo comum, sem permissão e sem destaque na lista de membros. Quem tem é mencionado nos
            cards de agora e quando alguém divulga uma jogatina. Cada um liga e desliga no ME AVISA
            ou em /avisos, então o cargo do bot precisa estar acima dele.
          </p>
          <DiscordField
            name="notifyRoleId"
            kind="role"
            label="Cargo de aviso"
            description="O cargo Bora. Vazio, os cards saem sem menção."
            placeholder="Nenhum cargo"
          />
        </Panel>
      </div>
    </ConfigForm>
  );
}
