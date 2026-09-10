'use client';

import { MAX_TIMEOUT_MS, type ModerationConfig } from '@goodbot/shared';
import { useFieldArray, useFormContext } from 'react-hook-form';

import { ConfigForm } from '@/components/config/config-form';
import { ModuleToggle } from '@/components/config/module-toggle';
import {
  DurationField,
  NumberField,
  SelectField,
  SwitchField,
  TextAreaField,
  TextField,
} from '@/components/config/fields';
import { Panel } from '@/components/retro/panel';
import { EmptyState } from '@/components/retro/states';

const ACTIONS = [
  { value: 'timeout', label: 'TIMEOUT' },
  { value: 'kick', label: 'KICK' },
  { value: 'ban', label: 'BAN' },
];

/**
 * §6.2 — a escalada é uma lista editável: N warns em X dias viram uma ação.
 * A ordem não importa para o bot (ele procura o degrau que bate), então não há
 * arrastar: só adicionar, editar e remover.
 */
function EscalationSteps() {
  const { control, watch, formState } = useFormContext<ModerationConfig>();
  const { fields, append, remove } = useFieldArray({ control, name: 'escalation.steps' });
  const disabled = formState.disabled;

  if (fields.length === 0) {
    return (
      <EmptyState
        description="Sem degraus: os warns só ficam registrados, nada acontece sozinho."
        action={
          <button
            type="button"
            className="btn-goodchat-outline"
            disabled={disabled}
            onClick={() =>
              append({ warns: 3, withinDays: 30, action: 'timeout', durationMs: 3_600_000 })
            }
          >
            CRIAR DEGRAU
          </button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {fields.map((field, index) => (
        <div
          key={field.id}
          className="grid gap-3 border-2 border-base-300 p-3 sm:grid-cols-2 xl:grid-cols-4"
        >
          <NumberField
            name={`escalation.steps.${index}.warns`}
            label="Warns"
            min={2}
            max={50}
            required
          />
          <NumberField
            name={`escalation.steps.${index}.withinDays`}
            label="Na janela de"
            min={1}
            max={365}
            suffix="DIAS"
            required
          />
          <SelectField
            name={`escalation.steps.${index}.action`}
            label="Ação"
            options={ACTIONS}
            required
          />
          {watch(`escalation.steps.${index}.action`) === 'timeout' ? (
            <DurationField
              name={`escalation.steps.${index}.durationMs`}
              label="Duração"
              max={MAX_TIMEOUT_MS}
              required
            />
          ) : (
            <div />
          )}
          <div className="xl:col-span-4">
            <button
              type="button"
              className="icon-btn"
              disabled={disabled}
              onClick={() => remove(index)}
            >
              REMOVER DEGRAU
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        className="btn-goodchat-outline self-start"
        disabled={disabled || fields.length >= 10}
        onClick={() =>
          append({ warns: 3, withinDays: 30, action: 'timeout', durationMs: 3_600_000 })
        }
      >
        ADICIONAR DEGRAU
      </button>
    </div>
  );
}

export function ModerationConfigForm({
  values,
  readOnly,
}: {
  values: ModerationConfig;
  readOnly: boolean;
}) {
  return (
    <ConfigForm page="moderation" defaultValues={values} readOnly={readOnly}>
      <ModuleToggle description="Comandos de punição, casos e escalada de warns." />
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="PADROES.CFG">
          <TextField
            name="defaultReason"
            label="Motivo padrão"
            description="Usado quando o comando não recebe motivo. Vai para o audit log do Discord."
            required
          />
          <NumberField
            name="banDeleteMessageDaysDefault"
            label="Purge padrão no ban"
            description="Dias de mensagens apagadas ao banir. O Discord aceita até 7."
            min={0}
            max={7}
            suffix="DIAS"
          />
          <DurationField
            name="defaultTimeoutMs"
            label="Duração padrão do timeout"
            description="Sugestão do modal Punir…; o limite do Discord é 28 dias."
            max={MAX_TIMEOUT_MS}
          />
        </Panel>

        <Panel title="DM.CFG">
          <TextAreaField
            name="dmFooter"
            label="Rodapé da DM de punição"
            description="Colado no fim da DM — bom lugar para o link de apelação."
            rows={4}
          />
          <p className="screen-meta">QUAIS PUNIÇÕES AVISAM POR DM FICAM NA TELA GERAL</p>
        </Panel>

        <Panel title="ESCALADA.CFG" className="xl:col-span-2">
          <SwitchField
            name="escalation.enabled"
            label="Escalada automática"
            description="Ao registrar um warn, o bot aplica o degrau que bater na contagem."
          />
          <EscalationSteps />
        </Panel>
      </div>
    </ConfigForm>
  );
}
