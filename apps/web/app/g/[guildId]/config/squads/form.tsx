'use client';

import { SQUAD_BLOCKS, type SquadsConfig } from '@goodbot/shared';

import { ConfigForm } from '@/components/config/config-form';
import { CHANNEL_TYPES } from '@/components/config/discord-options';
import { DiscordField, NumberField, TextField } from '@/components/config/fields';
import { ModuleToggle } from '@/components/config/module-toggle';
import { Panel } from '@/components/retro/panel';

export function SquadsConfigForm({
  values,
  readOnly,
}: {
  values: SquadsConfig;
  readOnly: boolean;
}) {
  return (
    <ConfigForm page="squads" defaultValues={values} readOnly={readOnly}>
      <ModuleToggle description="Squads fixos: perfil com agenda, match por horário, canal próprio e voice reservado nas jogatinas que o squad marca." />
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="BUSCA.CFG">
          <DiscordField
            name="searchChannelId"
            kind="channel"
            label="Canal de busca"
            description="Recebe a mensagem fixa com um botão por jogo e as threads privadas das propostas."
            placeholder="Nenhum canal"
          />
          <DiscordField
            name="pingRoleId"
            kind="role"
            label="Cargo avisado"
            description="Pingado só no primeiro envio da mensagem fixa, nunca nas threads."
            placeholder="Ninguém"
          />
          <NumberField
            name="proposalTtlHours"
            label="Prazo da proposta"
            description="Proposta sem nenhum aceite fecha depois disso."
            min={1}
            max={720}
            suffix="HORAS"
          />
          <NumberField
            name="reproposeCooldownDays"
            label="Pausa entre propostas iguais"
            description="A mesma dupla não é proposta de novo antes disso. 0 libera na hora."
            min={0}
            max={90}
            suffix="DIAS"
          />
          <NumberField name="maxSquadsPerUser" label="Squads por membro" min={1} max={5} />
        </Panel>

        <Panel title="JOGATINA.CFG">
          <DiscordField
            name="categoryId"
            kind="channel"
            channelTypes={[CHANNEL_TYPES.category]}
            label="Categoria dos squads"
            description="Onde nasce o canal de texto privado de cada squad."
            placeholder="Nenhuma categoria"
          />
          <TextField
            name="channelNaming"
            label="Nome do canal"
            description="{name} vira o nome do squad."
            required
          />
          <DiscordField
            name="voicePoolIds"
            kind="channel"
            multiple
            channelTypes={[CHANNEL_TYPES.voice]}
            label="Voices do rodízio"
            description="Reservados só durante a jogatina de cada squad. Com todos ocupados, o squad joga sem sala e é avisado."
          />
          <NumberField
            name="reminderMinutesBefore"
            label="Lembrete antes da jogatina"
            description="Avisa o squad e reserva o voice. Jogatina marcada para dentro desse prazo já sai com sala. 0 avisa na hora."
            min={0}
            max={240}
            suffix="MIN"
          />
          <NumberField
            name="sessionHours"
            label="Duração da jogatina"
            description="Depois disso o voice reservado volta para o rodízio."
            min={1}
            max={12}
            suffix="HORAS"
          />
          <NumberField
            name="maxUpcomingSessions"
            label="Jogatinas marcadas por squad"
            description="Quantas jogatinas futuras um squad pode ter ao mesmo tempo."
            min={1}
            max={10}
          />
          <NumberField
            name="inactiveWeeks"
            label="Semanas sem jogatina"
            description="Semanas seguidas sem jogatina marcada, voto Vou ou presença no voice. Depois disso o squad é questionado; uma semana depois, arquivado."
            min={1}
            max={52}
            suffix="SEMANAS"
          />
        </Panel>
      </div>

      <Panel title="GRADE.CFG">
        <p className="text-sm">
          A grade serve só para o match: quem marca a hora de jogar é o squad. As faixas não passam
          da meia-noite. A madrugada é o começo do dia: a madrugada de sábado é a noite de sexta
          para sábado. Mudar um horário vale também para os perfis que já existem.
        </p>
        {SQUAD_BLOCKS.map((key, index) => (
          <div key={key} className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
            <TextField name={`blocks.${index}.label`} label={`Faixa ${index + 1}`} required />
            <NumberField
              name={`blocks.${index}.startHour`}
              label="Começa"
              min={0}
              max={23}
              suffix="H"
            />
            <NumberField
              name={`blocks.${index}.endHour`}
              label="Termina"
              min={1}
              max={24}
              suffix="H"
            />
          </div>
        ))}
      </Panel>
    </ConfigForm>
  );
}
