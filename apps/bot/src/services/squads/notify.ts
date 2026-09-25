import { UserFacingError } from '@goodbot/shared';
import { PermissionFlagsBits } from 'discord.js';

import type { SquadsConfig } from '@goodbot/shared';
import type { Guild, GuildMember, Role } from 'discord.js';

const NOTIFY_REASON = 'Aviso de squad (ME AVISA)';

/**
 * O cargo que o bot vai dar ou tirar, com tudo conferido antes: configurado,
 * `ManageRoles` e o cargo do bot acima dele. A falta vira erro que diz à
 * pessoa o que pedir à staff (PRD §5.11, §10).
 */
export function assignableRole(guild: Guild, roleId: string | null, what: string): Role {
  const role = roleId ? guild.roles.cache.get(roleId) : undefined;
  if (!role) {
    throw new UserFacingError(`O cargo ${what} não está configurado. Avise a staff.`, {
      code: 'SQUADS_ROLE_MISSING',
    });
  }
  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    throw new UserFacingError('Eu não tenho a permissão **Gerenciar cargos**. Avise a staff.', {
      code: 'MISSING_PERMISSION',
    });
  }
  if (role.managed || role.position >= me.roles.highest.position) {
    throw new UserFacingError(
      `O cargo ${role.toString()} está acima do meu. A staff precisa subir o meu cargo na hierarquia.`,
      { code: 'BOT_ROLE_HIERARCHY' },
    );
  }
  return role;
}

/** `on`: agora a pessoa tem o `Bora` e é mencionada nos cards. */
export type NotifyState = 'on' | 'off';

export interface NotifyToggle {
  state: NotifyState;
  roleId: string;
}

/** ME AVISA e `/avisos`: quem tem o `Bora` o perde, quem não tem o ganha. */
export async function toggleNotify(
  member: GuildMember,
  config: Pick<SquadsConfig, 'notifyRoleId'>,
): Promise<NotifyToggle> {
  const role = assignableRole(member.guild, config.notifyRoleId, 'de aviso');
  if (member.roles.cache.has(role.id)) {
    await member.roles.remove(role, NOTIFY_REASON);
    return { state: 'off', roleId: role.id };
  }
  await member.roles.add(role, NOTIFY_REASON);
  return { state: 'on', roleId: role.id };
}

export function notifyText({ state, roleId }: NotifyToggle): string {
  return state === 'on'
    ? `Pronto: você tem o <@&${roleId}> e vai ser mencionado quando alguém procurar squad ` +
        'ou divulgar uma jogatina. Para parar, clique de novo ou use `/avisos`.'
    : `Pronto: você saiu do <@&${roleId}> e não é mais mencionado. Para voltar, clique de ` +
        'novo ou use `/avisos`.';
}
