import { UserFacingError } from '@goodbot/shared';

import type { CommandOverride } from '@goodbot/shared';

/**
 * Restrições de comando configuradas no painel (PRD §6.2). Aplicadas **depois**
 * do nível: o override só aperta o acesso, nunca libera quem o comando já
 * barraria. Lança `UserFacingError`, que vira embed efêmero.
 */
export function assertCommandAllowed(
  override: CommandOverride,
  input: { channelId: string; roleIds: readonly string[] },
): void {
  if (!override.enabled) {
    throw new UserFacingError('Este comando está desativado neste servidor.', {
      code: 'COMMAND_DISABLED',
    });
  }
  if (override.deniedChannelIds.includes(input.channelId)) {
    throw new UserFacingError('Este comando não pode ser usado neste canal.', {
      code: 'CHANNEL_DENIED',
    });
  }
  if (
    override.allowedChannelIds.length > 0 &&
    !override.allowedChannelIds.includes(input.channelId)
  ) {
    throw new UserFacingError('Este comando só funciona em canais específicos.', {
      code: 'CHANNEL_NOT_ALLOWED',
    });
  }
  if (
    override.allowedRoleIds.length > 0 &&
    !override.allowedRoleIds.some((roleId) => input.roleIds.includes(roleId))
  ) {
    throw new UserFacingError('Você não tem o cargo exigido para este comando.', {
      code: 'ROLE_NOT_ALLOWED',
    });
  }
}
