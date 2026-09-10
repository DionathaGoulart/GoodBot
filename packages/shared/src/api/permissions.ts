import { z } from 'zod';

/**
 * As permissões do Discord que o painel expõe na tela de cargos (PRD §6.3).
 * Os bits são os oficiais da API; `apps/bot` tem um teste que confere cada um
 * contra o `PermissionFlagsBits` do discord.js, então um erro de digitação aqui
 * quebra o `pnpm test` e não o servidor de alguém.
 *
 * A lista é curada: permissões que não fazem sentido num painel de moderação
 * (monetização, insights) ficam de fora — o bitfield que não conhecemos é
 * preservado na hora de salvar, ver `mergePermissions`.
 */
export const PERMISSION_BITS = {
  CreateInstantInvite: 1n << 0n,
  KickMembers: 1n << 1n,
  BanMembers: 1n << 2n,
  Administrator: 1n << 3n,
  ManageChannels: 1n << 4n,
  ManageGuild: 1n << 5n,
  AddReactions: 1n << 6n,
  ViewAuditLog: 1n << 7n,
  PrioritySpeaker: 1n << 8n,
  Stream: 1n << 9n,
  ViewChannel: 1n << 10n,
  SendMessages: 1n << 11n,
  SendTTSMessages: 1n << 12n,
  ManageMessages: 1n << 13n,
  EmbedLinks: 1n << 14n,
  AttachFiles: 1n << 15n,
  ReadMessageHistory: 1n << 16n,
  MentionEveryone: 1n << 17n,
  UseExternalEmojis: 1n << 18n,
  Connect: 1n << 20n,
  Speak: 1n << 21n,
  MuteMembers: 1n << 22n,
  DeafenMembers: 1n << 23n,
  MoveMembers: 1n << 24n,
  UseVAD: 1n << 25n,
  ChangeNickname: 1n << 26n,
  ManageNicknames: 1n << 27n,
  ManageRoles: 1n << 28n,
  ManageWebhooks: 1n << 29n,
  ManageGuildExpressions: 1n << 30n,
  UseApplicationCommands: 1n << 31n,
  ManageEvents: 1n << 33n,
  ManageThreads: 1n << 34n,
  CreatePublicThreads: 1n << 35n,
  CreatePrivateThreads: 1n << 36n,
  UseExternalStickers: 1n << 37n,
  SendMessagesInThreads: 1n << 38n,
  ModerateMembers: 1n << 40n,
  SendPolls: 1n << 49n,
} as const;

export type PermissionName = keyof typeof PERMISSION_BITS;

export const PERMISSION_NAMES = Object.keys(PERMISSION_BITS) as PermissionName[];

/** Rótulo em pt-BR de cada permissão, como o painel a chama. */
export const PERMISSION_LABELS: Record<PermissionName, string> = {
  CreateInstantInvite: 'Criar convite',
  KickMembers: 'Expulsar membros',
  BanMembers: 'Banir membros',
  Administrator: 'Administrador',
  ManageChannels: 'Gerenciar canais',
  ManageGuild: 'Gerenciar servidor',
  AddReactions: 'Adicionar reações',
  ViewAuditLog: 'Ver registro de auditoria',
  PrioritySpeaker: 'Voz prioritária',
  Stream: 'Transmitir vídeo',
  ViewChannel: 'Ver canais',
  SendMessages: 'Enviar mensagens',
  SendTTSMessages: 'Enviar mensagens TTS',
  ManageMessages: 'Gerenciar mensagens',
  EmbedLinks: 'Inserir links',
  AttachFiles: 'Anexar arquivos',
  ReadMessageHistory: 'Ver histórico',
  MentionEveryone: 'Mencionar @everyone',
  UseExternalEmojis: 'Usar emojis externos',
  Connect: 'Conectar em voz',
  Speak: 'Falar',
  MuteMembers: 'Silenciar membros',
  DeafenMembers: 'Ensurdecer membros',
  MoveMembers: 'Mover membros',
  UseVAD: 'Detecção de voz',
  ChangeNickname: 'Mudar o próprio apelido',
  ManageNicknames: 'Gerenciar apelidos',
  ManageRoles: 'Gerenciar cargos',
  ManageWebhooks: 'Gerenciar webhooks',
  ManageGuildExpressions: 'Gerenciar emojis e figurinhas',
  UseApplicationCommands: 'Usar comandos de aplicativo',
  ManageEvents: 'Gerenciar eventos',
  ManageThreads: 'Gerenciar tópicos',
  CreatePublicThreads: 'Criar tópicos públicos',
  CreatePrivateThreads: 'Criar tópicos privados',
  UseExternalStickers: 'Usar figurinhas externas',
  SendMessagesInThreads: 'Enviar mensagens em tópicos',
  ModerateMembers: 'Aplicar castigo (timeout)',
  SendPolls: 'Criar enquetes',
};

/** Agrupamento da checklist do formulário de cargo (§6.4). */
export const PERMISSION_GROUPS: { label: string; permissions: PermissionName[] }[] = [
  {
    label: 'SERVIDOR',
    permissions: [
      'Administrator',
      'ManageGuild',
      'ManageRoles',
      'ManageChannels',
      'ManageWebhooks',
      'ManageGuildExpressions',
      'ManageEvents',
      'ViewAuditLog',
      'CreateInstantInvite',
    ],
  },
  {
    label: 'MEMBROS',
    permissions: [
      'KickMembers',
      'BanMembers',
      'ModerateMembers',
      'ManageNicknames',
      'ChangeNickname',
    ],
  },
  {
    label: 'TEXTO',
    permissions: [
      'ViewChannel',
      'SendMessages',
      'SendMessagesInThreads',
      'CreatePublicThreads',
      'CreatePrivateThreads',
      'ManageThreads',
      'ManageMessages',
      'EmbedLinks',
      'AttachFiles',
      'ReadMessageHistory',
      'AddReactions',
      'UseExternalEmojis',
      'UseExternalStickers',
      'MentionEveryone',
      'SendTTSMessages',
      'SendPolls',
      'UseApplicationCommands',
    ],
  },
  {
    label: 'VOZ',
    permissions: [
      'Connect',
      'Speak',
      'Stream',
      'UseVAD',
      'PrioritySpeaker',
      'MuteMembers',
      'DeafenMembers',
      'MoveMembers',
    ],
  },
];

/**
 * Permissões que fazem um cargo valer o badge `PERIGOSO` na tabela (§6.3):
 * qualquer uma delas permite escalar privilégio ou destruir o servidor.
 */
export const DANGEROUS_PERMISSIONS: PermissionName[] = [
  'Administrator',
  'ManageGuild',
  'ManageRoles',
  'ManageChannels',
  'ManageWebhooks',
  'BanMembers',
  'KickMembers',
  'ModerateMembers',
  'ManageMessages',
  'MentionEveryone',
];

/** Bitfield do Discord como texto — é assim que ele viaja no JSON. */
export const PermissionBitfieldSchema = z
  .string()
  .regex(/^\d{1,25}$/, { message: 'Bitfield de permissões inválido' });

/** Lista de permissões aceita nos formulários; nomes desconhecidos são recusados. */
export const PermissionNamesSchema = z
  .array(z.enum(PERMISSION_NAMES as [PermissionName, ...PermissionName[]]))
  .max(PERMISSION_NAMES.length)
  .transform((names) => [...new Set(names)]);

export function toBitfield(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

/** Nomes → bitfield textual. */
export function permissionsToBitfield(names: readonly PermissionName[]): string {
  return names.reduce((acc, name) => acc | PERMISSION_BITS[name], 0n).toString();
}

/** Bitfield textual → nomes conhecidos, na ordem de `PERMISSION_BITS`. */
export function bitfieldToPermissions(bitfield: string): PermissionName[] {
  const bits = toBitfield(bitfield);
  return PERMISSION_NAMES.filter(
    (name) => (bits & PERMISSION_BITS[name]) === PERMISSION_BITS[name],
  );
}

/** As permissões perigosas que este bitfield concede (vazio = cargo comum). */
export function dangerousPermissions(bitfield: string): PermissionName[] {
  const bits = toBitfield(bitfield);
  return DANGEROUS_PERMISSIONS.filter(
    (name) => (bits & PERMISSION_BITS[name]) === PERMISSION_BITS[name],
  );
}

export function hasDangerousPermissions(bitfield: string): boolean {
  return dangerousPermissions(bitfield).length > 0;
}

/**
 * Aplica a checklist do painel sobre o bitfield atual do cargo **sem** apagar
 * os bits que o painel não mostra: quem marcou uma permissão nova no Discord
 * não a perde só por alguém ter salvo o cargo aqui.
 */
export function mergePermissions(current: string, names: readonly PermissionName[]): string {
  const known = PERMISSION_NAMES.reduce((acc, name) => acc | PERMISSION_BITS[name], 0n);
  const kept = toBitfield(current) & ~known;
  return (kept | toBitfield(permissionsToBitfield(names))).toString();
}

/**
 * O que o bot pede ao ser convidado (PRD §10). Sem `Administrator`: cada
 * permissão daqui cobre uma tela ou um comando, e a que faltar degrada aquela
 * parte em vez de derrubar o resto.
 *
 * A lista mora aqui, e não no painel, porque o número que vai na URL do
 * convite tem de sair dos mesmos bits que o teste de `apps/bot` confere contra
 * o `PermissionFlagsBits` do discord.js.
 */
export const BOT_INVITE_PERMISSION_NAMES = [
  'ViewChannel',
  'SendMessages',
  'SendMessagesInThreads',
  'EmbedLinks',
  'AttachFiles',
  'ReadMessageHistory',
  'ManageMessages',
  'ManageChannels',
  'ManageRoles',
  'ManageGuild',
  'KickMembers',
  'BanMembers',
  'ModerateMembers',
  'ViewAuditLog',
  'ManageThreads',
  'AddReactions',
  'UseExternalEmojis',
  'MuteMembers',
  'DeafenMembers',
  'MoveMembers',
  'CreateInstantInvite',
  'ManageEvents',
  'ManageGuildExpressions',
] as const satisfies readonly PermissionName[];

/** O `permissions=` da URL de convite, em decimal como o Discord espera. */
export const BOT_INVITE_PERMISSIONS = permissionsToBitfield(BOT_INVITE_PERMISSION_NAMES);
