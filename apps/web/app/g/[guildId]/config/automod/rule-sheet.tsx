'use client';

import * as React from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  AUTOMOD_RULE_TYPES,
  AutomodRuleSchema,
  MAX_TIMEOUT_MS,
  RAID_ACTIONS,
  WORD_MATCH_MODES,
  type AutomodAction,
  type AutomodRule,
  type AutomodRuleType,
} from '@cobot/shared';
import { useFieldArray, useForm, useFormContext } from 'react-hook-form';
import { toast } from 'sonner';

import { saveAutomodRuleAction } from '@/app/actions/modules';
import {
  DiscordField,
  DurationField,
  NumberField,
  SelectField,
  SwitchField,
  TextAreaField,
  TextField,
} from '@/components/config/fields';
import { Form } from '@/components/ui/form';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

import { emptyRule, resetForType } from './rule-defaults';

/** Rótulos das telas; a fonte dos valores continua sendo `@cobot/shared`. */
const TYPE_LABEL: Record<AutomodRuleType, string> = {
  spam: 'SPAM',
  links: 'LINKS',
  caps: 'CAPS',
  words: 'PALAVRAS',
  mentions: 'MENÇÕES',
  raid: 'ANTI-RAID',
};

const ACTION_LABEL: Record<AutomodAction, string> = {
  delete: 'Apagar a mensagem',
  warn: 'Registrar warn',
  timeout: 'Timeout',
  kick: 'Expulsar',
  ban: 'Banir',
  notify_modlog: 'Avisar no mod-log',
  dm_user: 'Mandar DM',
};

const WORD_MODE_LABEL: Record<(typeof WORD_MATCH_MODES)[number], string> = {
  exact: 'PALAVRA EXATA',
  wildcard: 'COM CURINGA (*)',
  regex: 'REGEX',
};

const RAID_ACTION_LABEL: Record<(typeof RAID_ACTIONS)[number], string> = {
  kick: 'EXPULSAR',
  ban: 'BANIR',
  require_account_age: 'SÓ CONTAS ANTIGAS',
};

/** Uma lista de strings (domínios, palavras) editada como textarea, uma por linha. */
function LinesField({
  name,
  label,
  description,
  required,
}: {
  name: string;
  label: string;
  description?: string;
  required?: boolean;
}) {
  const { watch, setValue, formState } = useFormContext();
  const value = (watch(name) as string[] | undefined) ?? [];
  // Estado local para o usuário poder digitar linhas em branco sem que elas
  // desapareçam a cada tecla.
  const [text, setText] = React.useState(value.join('\n'));

  React.useEffect(() => {
    setText((current) =>
      current.split('\n').map((line) => line.trim()).filter(Boolean).join('\n') ===
      value.join('\n')
        ? current
        : value.join('\n'),
    );
    // Só reagimos a uma troca de regra: `value` vem do form, `text` é o rascunho.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  return (
    <div className="flex flex-col gap-1.5">
      <label className="section-label" htmlFor={name}>
        {label}
        {required ? <span className="text-accent"> *</span> : null}
      </label>
      {description ? <p className="text-xs opacity-60">{description}</p> : null}
      <textarea
        id={name}
        rows={6}
        className="field-textarea"
        disabled={formState.disabled}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setValue(
            name,
            event.target.value.split('\n').map((line) => line.trim()).filter(Boolean),
            { shouldDirty: true, shouldValidate: true },
          );
        }}
      />
    </div>
  );
}

/** Os campos que só existem para um `type` — a parte "dinâmica" do formulário. */
function TypeFields({ type }: { type: AutomodRuleType }) {
  if (type === 'spam') {
    return (
      <>
        <NumberField name="config.maxMessages" label="Mensagens" min={2} max={50} required />
        <NumberField
          name="config.intervalSeconds"
          label="Na janela de"
          min={1}
          max={120}
          suffix="SEG"
          required
        />
        <NumberField
          name="config.maxDuplicates"
          label="Repetições idênticas"
          description="0 desliga a checagem de mensagens repetidas."
          min={0}
          max={20}
        />
        <SwitchField
          name="config.perChannel"
          label="Contar por canal"
          description="Desligado, a janela vale para o servidor inteiro."
        />
      </>
    );
  }

  if (type === 'links') {
    return (
      <>
        <SwitchField name="config.blockInvites" label="Bloquear convites do Discord" />
        <SwitchField
          name="config.invitesOnly"
          label="Só convites"
          description="Ligado, links comuns passam e só os convites são filtrados."
        />
        <LinesField
          name="config.allowedDomains"
          label="Domínios liberados"
          description="Um por linha, sem http:// (ex.: youtube.com)."
        />
        <DiscordField
          name="config.allowedChannelIds"
          kind="channel"
          multiple
          label="Canais onde links passam"
          placeholder="Nenhum"
        />
      </>
    );
  }

  if (type === 'caps') {
    return (
      <>
        <NumberField
          name="config.minPercent"
          label="Maiúsculas"
          description="Percentual mínimo entre as letras da mensagem."
          min={1}
          max={100}
          suffix="%"
          required
        />
        <NumberField
          name="config.minLength"
          label="Tamanho mínimo"
          description="Mensagens menores que isso não são avaliadas."
          min={1}
          max={500}
          suffix="LETRAS"
          required
        />
      </>
    );
  }

  if (type === 'words') {
    return (
      <>
        <SelectField
          name="config.mode"
          label="Tipo de comparação"
          options={WORD_MATCH_MODES.map((mode) => ({ value: mode, label: WORD_MODE_LABEL[mode] }))}
          required
        />
        <LinesField
          name="config.words"
          label="Palavras"
          description="Uma por linha. Em regex, cada linha é um padrão."
          required
        />
        <SwitchField name="config.caseSensitive" label="Diferenciar maiúsculas" />
        <SwitchField
          name="config.normalizeDiacritics"
          label="Ignorar acentos"
          description='Ligado, "cão" também pega "cao".'
        />
      </>
    );
  }

  if (type === 'mentions') {
    return (
      <>
        <NumberField name="config.maxMentions" label="Menções por mensagem" min={1} max={50} required />
        <SwitchField name="config.countRoles" label="Contar menções de cargo" />
        <SwitchField
          name="config.blockEveryone"
          label="Bloquear @everyone/@here"
          description="Só de quem não tem a permissão nativa para usá-los."
        />
      </>
    );
  }

  return (
    <>
      <NumberField name="config.joins" label="Entradas" min={3} max={500} required />
      <NumberField
        name="config.intervalSeconds"
        label="Na janela de"
        min={5}
        max={600}
        suffix="SEG"
        required
      />
      <NumberField
        name="config.raidModeMinutes"
        label="Duração do modo raid"
        min={1}
        max={1440}
        suffix="MIN"
        required
      />
      <SelectField
        name="config.action"
        label="O que fazer com quem entrar"
        options={RAID_ACTIONS.map((action) => ({
          value: action,
          label: RAID_ACTION_LABEL[action],
        }))}
        required
      />
      <NumberField
        name="config.minAccountAgeDays"
        label="Idade mínima da conta"
        description="Só vale para a ação SÓ CONTAS ANTIGAS."
        min={1}
        max={365}
        suffix="DIAS"
      />
      <SwitchField name="config.alertModlog" label="Avisar no mod-log ao ativar" />
    </>
  );
}

/** Lista de ações: cada tipo aparece no máximo uma vez (regra do schema). */
function ActionsField({ type }: { type: AutomodRuleType }) {
  const { control, watch, formState } = useFormContext<AutomodRule>();
  const { fields, append, remove } = useFieldArray({ control, name: 'actions' });
  const actions = watch('actions') ?? [];
  const used = new Set(actions.map((action) => action.type));
  // Regra anti-raid roda em `guildMemberAdd`: não existe mensagem para apagar.
  const available = (Object.keys(ACTION_LABEL) as AutomodAction[]).filter(
    (action) => !used.has(action) && !(type === 'raid' && action === 'delete'),
  );

  return (
    <div className="flex flex-col gap-3">
      <p className="section-label">AÇÕES</p>
      {fields.map((field, index) => {
        const action = actions[index];
        return (
          <div key={field.id} className="flex flex-col gap-3 border-2 border-base-300 p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-bold">
                {ACTION_LABEL[action?.type as AutomodAction] ?? action?.type}
              </span>
              <button
                type="button"
                className="icon-btn"
                disabled={formState.disabled}
                onClick={() => remove(index)}
              >
                REMOVER
              </button>
            </div>
            {action?.type === 'timeout' ? (
              <DurationField
                name={`actions.${index}.durationMs`}
                label="Duração"
                max={MAX_TIMEOUT_MS}
                required
              />
            ) : null}
            {action?.type === 'ban' ? (
              <NumberField
                name={`actions.${index}.deleteMessageDays`}
                label="Purge no ban"
                min={0}
                max={7}
                suffix="DIAS"
              />
            ) : null}
            {action?.type === 'dm_user' ? (
              <TextAreaField name={`actions.${index}.message`} label="Mensagem da DM" rows={3} />
            ) : null}
            {action && ['warn', 'timeout', 'kick', 'ban'].includes(action.type) ? (
              <TextField name={`actions.${index}.reason`} label="Motivo" />
            ) : null}
          </div>
        );
      })}

      <div className="flex flex-wrap gap-2">
        {available.map((action) => (
          <button
            key={action}
            type="button"
            className="icon-btn"
            disabled={formState.disabled}
            onClick={() =>
              append(
                action === 'timeout'
                  ? { type: 'timeout', durationMs: 600_000 }
                  : action === 'ban'
                    ? { type: 'ban', deleteMessageDays: 0 }
                    : { type: action },
              )
            }
          >
            + {ACTION_LABEL[action].toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  );
}

export interface RuleEditing {
  rule: AutomodRule;
  /** `null` = criando. */
  id: string | null;
}

/**
 * O editor de regra. O formulário troca de campos conforme o `type`: mudar o
 * tipo reinicia `config` e `actions` com os defaults daquele tipo, porque um
 * config de `spam` não vale nada dentro de uma regra `caps`.
 */
export function RuleSheet({
  editing,
  readOnly,
  onClose,
}: {
  editing: RuleEditing | null;
  readOnly: boolean;
  onClose: (changed: boolean) => void;
}) {
  const form = useForm<AutomodRule>({
    // `as never`: o schema tem defaults, então a entrada do resolver é mais
    // frouxa que a saída e o RHF não reconcilia os dois genéricos sozinho.
    resolver: zodResolver(AutomodRuleSchema as never),
    defaultValues: editing?.rule ?? emptyRule(),
    disabled: readOnly,
  });
  const [saving, setSaving] = React.useState(false);
  const type = form.watch('type');
  const lastType = React.useRef<AutomodRuleType | null>(null);

  React.useEffect(() => {
    if (!editing) return;
    form.reset(editing.rule);
    lastType.current = editing.rule.type;
  }, [editing, form]);

  // Trocar o tipo no select zera `config` e `actions`: um config de `spam` não
  // passa no schema de `caps`, e o formulário ficaria preso num erro invisível.
  React.useEffect(() => {
    if (lastType.current === null || lastType.current === type) {
      lastType.current = type;
      return;
    }
    lastType.current = type;
    form.reset(resetForType(form.getValues(), type), { keepDirty: true });
  }, [type, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    setSaving(true);
    try {
      const formData = new FormData();
      formData.set('rule', JSON.stringify(values));
      if (editing?.id) formData.set('ruleId', editing.id);
      const result = await saveAutomodRuleAction(formData);
      if (!result.ok) {
        for (const [path, message] of Object.entries(result.fieldErrors ?? {})) {
          form.setError(path as never, { message });
        }
        toast.error('ERRO', { description: result.message });
        return;
      }
      toast.success('SALVO', { description: result.message ?? `A regra ${values.name} está no ar.` });
      onClose(true);
    } finally {
      setSaving(false);
    }
  });

  return (
    <Sheet open={editing !== null} onOpenChange={(open) => !open && onClose(false)}>
      <SheetContent className="w-full sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{editing?.id ? 'EDITAR REGRA' : 'NOVA REGRA'}</SheetTitle>
          <SheetDescription>
            A primeira regra que disparar executa as ações; as seguintes são ignoradas.
          </SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form
            onSubmit={onSubmit}
            className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4"
          >
            <fieldset disabled={readOnly} className="flex flex-col gap-4">
              <TextField name="name" label="Nome" required />
              <SelectField
                name="type"
                label="Tipo"
                options={AUTOMOD_RULE_TYPES.map((value) => ({
                  value,
                  label: TYPE_LABEL[value],
                }))}
                required
              />
              <SwitchField name="enabled" label="Regra ativa" />
              <TypeFields type={type} />
              <ActionsField type={type} />
              <DiscordField
                name="exemptRoleIds"
                kind="role"
                multiple
                label="Cargos isentos desta regra"
                placeholder="Nenhum"
              />
              <DiscordField
                name="exemptChannelIds"
                kind="channel"
                multiple
                label="Canais isentos desta regra"
                placeholder="Nenhum"
              />
            </fieldset>

            {readOnly ? (
              <p className="screen-meta">MODO LEITURA · SÓ ADMIN PODE SALVAR</p>
            ) : (
              <SheetFooter className="px-0">
                <button type="submit" className="btn-goodchat" disabled={saving}>
                  {saving ? 'SALVANDO_' : 'SALVAR'}
                </button>
              </SheetFooter>
            )}
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
