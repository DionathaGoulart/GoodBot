'use client';

import { useFormContext } from 'react-hook-form';

import { publishSquadPanelAction } from '@/app/actions/squads';
import { ActionButton } from '@/components/config/confirm-button';
import { ConfigForm } from '@/components/config/config-form';
import { CHANNEL_TYPES } from '@/components/config/discord-options';
import { DiscordField, LinesField, NumberField } from '@/components/config/fields';
import { ModuleToggle } from '@/components/config/module-toggle';
import { Panel } from '@/components/retro/panel';
import { useGuildId } from '@/lib/use-guild-id';

import type { SquadsConfig } from '@goodbot/shared';

interface PublishedPanel {
  channelId: string;
  messageId: string;
}

/**
 * O painel fixo das salas. Quem publica é o bot, com o config **salvo**: com o
 * formulário sujo o botão espera, senão a staff trocaria o canal, clicaria e
 * veria o painel sair no canal antigo.
 */
function PanelMessage({
  published,
  readOnly,
}: {
  published: PublishedPanel | null;
  readOnly: boolean;
}) {
  const guildId = useGuildId();
  const dirty = useFormContext<SquadsConfig>().formState.isDirty;

  return (
    <Panel
      title="PAINEL.MSG"
      actions={
        readOnly ? null : (
          <ActionButton
            label={published ? 'ATUALIZAR' : 'PUBLICAR'}
            busyLabel="PUBLICANDO_"
            successTitle={published ? 'ATUALIZADO' : 'PUBLICADO'}
            disabled={dirty}
            action={() => publishSquadPanelAction(guildId)}
          />
        )
      }
    >
      <p className="text-sm">
        Mensagem fixa no canal do painel com as salas abertas, as próximas jogatinas da agenda e os
        botões BUSCAR SQUAD, SEM AVISO e MARCAR JOGATINA. Depois de publicada, o bot edita sozinho a
        cada sala que abre, enche ou some e a cada jogatina marcada.
      </p>
      <p className="screen-meta">
        {published ? (
          <a
            href={`https://discord.com/channels/${guildId}/${published.channelId}/${published.messageId}`}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            NO AR · ABRIR NO DISCORD
          </a>
        ) : (
          'NÃO PUBLICADO'
        )}
      </p>
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
  published: PublishedPanel | null;
  readOnly: boolean;
}) {
  return (
    <ConfigForm page="squads" defaultValues={values} readOnly={readOnly}>
      <ModuleToggle description="Quem quer jogar agora ganha um cargo, entra no ➕ Criar Squad e cai numa sala de voz que some quando esvazia. Desligado, o bot para de reagir; cargos e salas que já existem ficam como estão." />

      <PanelMessage published={published} readOnly={readOnly} />

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="CARGOS.CFG">
          <p className="text-sm">
            Cargos comuns, criados pela staff. O bot só liga e desliga, então o cargo dele precisa
            estar acima dos dois.
          </p>
          <DiscordField
            name="searchRoleId"
            kind="role"
            label="Cargo de busca"
            description="Quem está buscando squad agora. Deixe o cargo separado na lista de membros (hoist)."
            placeholder="Nenhum cargo"
          />
          <DiscordField
            name="optOutRoleId"
            kind="role"
            label="Cargo de sem aviso"
            description="Quem tem nunca recebe a DM automática ao abrir o jogo. Ainda busca à mão."
            placeholder="Nenhum cargo"
          />
          <NumberField
            name="searchTtlMinutes"
            label="Expiração da busca"
            description="Quem liga a busca e não entra em voz nesse prazo perde o cargo."
            min={15}
            max={720}
            suffix="MIN"
          />
          <LinesField
            name="gameNames"
            label="Jogos que disparam o aviso"
            description="Um por linha, como aparece no Discord. Sem ™ e sem diferenciar caixa. Vazio desliga o aviso automático."
            rows={3}
          />
        </Panel>

        <Panel title="SALAS.CFG">
          <DiscordField
            name="panelChannelId"
            kind="channel"
            label="Canal do painel"
            description="Canal de texto onde fica a mensagem fixa com as salas abertas."
            placeholder="Nenhum canal"
          />
          <DiscordField
            name="agendaChannelId"
            kind="channel"
            label="Canal da agenda"
            description="Canal de texto onde cada jogatina marcada vira uma mensagem com a lista de quem vai e uma thread. Só o bot escreve; threads liberadas. Vazio, MARCAR JOGATINA recusa."
            placeholder="Nenhum canal"
          />
          <DiscordField
            name="categoryId"
            kind="channel"
            channelTypes={[CHANNEL_TYPES.category]}
            label="Categoria das salas"
            description="É do módulo: voz aqui com nome Squad Alfa, Squad Beta... é apagado quando esvazia."
            placeholder="Nenhuma categoria"
          />
          <DiscordField
            name="createChannelId"
            kind="channel"
            channelTypes={[CHANNEL_TYPES.voice]}
            label="Canal de criar"
            description="O voz ➕ Criar Squad: quem entra ganha uma sala nova e é movido para ela."
            placeholder="Nenhum canal"
          />
          <NumberField
            name="roomSize"
            label="Tamanho da sala"
            description="Limite de gente em cada sala, aplicado pelo próprio Discord."
            min={2}
            max={10}
            suffix="PESSOAS"
          />
          <NumberField
            name="graceMinutes"
            label="Janela de tolerância"
            description="Quem sai da voz só perde o cargo, e a sala vazia só some, depois disso. Cobre queda de conexão. 0 é na hora."
            min={0}
            max={10}
            suffix="MIN"
          />
        </Panel>
      </div>
    </ConfigForm>
  );
}
