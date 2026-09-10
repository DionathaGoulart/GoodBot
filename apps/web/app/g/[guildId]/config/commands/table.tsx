'use client';

import * as React from 'react';
import {
  DEFAULT_COMMAND_OVERRIDE,
  type CommandOverride,
  type CommandSummary,
  type UtilitiesConfig,
} from '@goodbot/shared';
import { useFormContext } from 'react-hook-form';

import { ConfigForm } from '@/components/config/config-form';
import { DiscordField } from '@/components/config/fields';
import { Panel } from '@/components/retro/panel';
import { Tag } from '@/components/retro/tag';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const LEVEL_LABEL = { member: 'MEMBRO', mod: 'MODERAÇÃO', admin: 'ADMIN' } as const;

/**
 * Os campos de um comando. Só existem sob `commandOverrides.<nome>`, e a linha
 * só ganha esse objeto quando o usuário mexe nela — o mapa guarda exceções,
 * não uma cópia de todos os comandos.
 */
function CommandRow({
  command,
  readOnly,
  expanded,
  onToggleExpanded,
}: {
  command: CommandSummary;
  readOnly: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const { watch, setValue } = useFormContext<UtilitiesConfig>();
  const path = `commandOverrides.${command.name}` as const;
  const override = (watch(path) as CommandOverride | undefined) ?? DEFAULT_COMMAND_OVERRIDE;
  const restricted =
    !override.enabled ||
    override.allowedRoleIds.length > 0 ||
    override.allowedChannelIds.length > 0 ||
    override.deniedChannelIds.length > 0;

  /** Mexer numa linha sem override materializa o objeto inteiro. */
  const patch = (changes: Partial<CommandOverride>) =>
    setValue(path, { ...override, ...changes }, { shouldDirty: true, shouldValidate: true });

  return (
    <>
      <TableRow>
        <TableCell className="font-bold">
          /{command.name}
          {command.kind === 'user_context' ? (
            <Tag tone="muted" className="ml-2">
              MENU
            </Tag>
          ) : null}
          <p className="screen-meta font-normal">{command.description}</p>
        </TableCell>
        <TableCell>
          <Tag tone="muted">{command.module}</Tag>
        </TableCell>
        <TableCell>
          <Tag>{LEVEL_LABEL[command.level]}</Tag>
        </TableCell>
        <TableCell>
          <Switch
            checked={override.enabled}
            disabled={readOnly}
            aria-label={`Comando ${command.name} ativo`}
            onCheckedChange={(checked) => patch({ enabled: checked })}
          />
        </TableCell>
        <TableCell className="flex justify-end gap-2">
          {restricted && !expanded ? <Tag tone="warning">RESTRITO</Tag> : null}
          <button type="button" className="icon-btn" onClick={onToggleExpanded}>
            {expanded ? 'FECHAR' : 'RESTRIÇÕES'}
          </button>
        </TableCell>
      </TableRow>

      {expanded ? (
        <TableRow>
          <TableCell colSpan={5}>
            <div className="grid gap-4 py-2 xl:grid-cols-3">
              <DiscordField
                name={`${path}.allowedRoleIds`}
                kind="role"
                multiple
                label="Cargos permitidos"
                description="Vazio = qualquer um que já passe no nível do comando."
                placeholder="Sem restrição de cargo"
              />
              <DiscordField
                name={`${path}.allowedChannelIds`}
                kind="channel"
                multiple
                label="Canais permitidos"
                description="Vazio = todos os canais."
                placeholder="Todos os canais"
              />
              <DiscordField
                name={`${path}.deniedChannelIds`}
                kind="channel"
                multiple
                label="Canais negados"
                description="Vence a lista de permitidos."
                placeholder="Nenhum"
              />
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

function CommandsGrid({ commands, readOnly }: { commands: CommandSummary[]; readOnly: boolean }) {
  const [expanded, setExpanded] = React.useState<string | null>(null);

  return (
    <Panel title="COMANDOS.LST">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>COMANDO</TableHead>
              <TableHead>MÓDULO</TableHead>
              <TableHead>NÍVEL</TableHead>
              <TableHead>ATIVO</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {commands.map((command) => (
              <CommandRow
                key={command.name}
                command={command}
                readOnly={readOnly}
                expanded={expanded === command.name}
                onToggleExpanded={() =>
                  setExpanded((current) => (current === command.name ? null : command.name))
                }
              />
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="screen-meta">
        AS RESTRIÇÕES SÓ APERTAM O ACESSO · O NÍVEL DO COMANDO CONTINUA VALENDO
      </p>
    </Panel>
  );
}

/**
 * As permissões de comando moram em `utilities.commandOverrides`, então o
 * formulário carrega o módulo `utilities` inteiro e devolve o resto sem tocar.
 */
export function CommandsForm({
  values,
  commands,
  readOnly,
}: {
  values: UtilitiesConfig;
  commands: CommandSummary[];
  readOnly: boolean;
}) {
  return (
    <ConfigForm page="commands" defaultValues={values} readOnly={readOnly}>
      <CommandsGrid commands={commands} readOnly={readOnly} />
    </ConfigForm>
  );
}
