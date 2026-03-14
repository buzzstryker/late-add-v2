/**
 * Auth Service — framework-agnostic permission logic for group RBAC.
 *
 * 3-tier model:
 *   super_admin  → app owner (full access to ALL groups)
 *   admin        → group_members.role = 'admin' (manage their group)
 *   member       → group_members.role = 'member' (view only)
 */
import { GroupMemberRole } from '../models/League';

export type EffectiveRole = 'super_admin' | 'admin' | 'member';

export type GroupPermission =
  | 'edit_group'
  | 'manage_members'
  | 'delete_group'
  | 'toggle_roles'
  | 'delete_round';

/**
 * Determine the effective role for a player in a group.
 *
 * Super admin check comes first (app owner always wins regardless of membership).
 * Then falls back to the player's group_members.role.
 */
export function getEffectiveRole(
  ownerPlayerId: string | null,
  currentPlayerId: string | null,
  memberRole: GroupMemberRole | null,
): EffectiveRole | null {
  if (!currentPlayerId) return null;
  // App owner = super admin regardless of group membership
  if (ownerPlayerId && currentPlayerId === ownerPlayerId) return 'super_admin';
  if (memberRole === 'admin') return 'admin';
  if (memberRole === 'member') return 'member';
  return null;
}

/**
 * Check whether a role has a specific group permission.
 *
 * super_admin → all permissions
 * admin       → edit_group, manage_members, delete_group, toggle_roles
 * member/null → none
 */
export function hasPermission(
  role: EffectiveRole | null,
  permission: GroupPermission,
): boolean {
  if (!role) return false;
  if (role === 'super_admin') return true;
  if (role === 'admin') return true; // admins have all group-level permissions
  return false;
}

// ── Convenience Wrappers ──

export function canEditGroup(
  ownerPlayerId: string | null,
  currentPlayerId: string | null,
  memberRole: GroupMemberRole | null,
): boolean {
  return hasPermission(getEffectiveRole(ownerPlayerId, currentPlayerId, memberRole), 'edit_group');
}

export function canManageMembers(
  ownerPlayerId: string | null,
  currentPlayerId: string | null,
  memberRole: GroupMemberRole | null,
): boolean {
  return hasPermission(getEffectiveRole(ownerPlayerId, currentPlayerId, memberRole), 'manage_members');
}

export function canDeleteGroup(
  ownerPlayerId: string | null,
  currentPlayerId: string | null,
  memberRole: GroupMemberRole | null,
): boolean {
  return hasPermission(getEffectiveRole(ownerPlayerId, currentPlayerId, memberRole), 'delete_group');
}

export function canToggleRoles(
  ownerPlayerId: string | null,
  currentPlayerId: string | null,
  memberRole: GroupMemberRole | null,
): boolean {
  return hasPermission(getEffectiveRole(ownerPlayerId, currentPlayerId, memberRole), 'toggle_roles');
}

/**
 * Check if the current player can delete a round.
 *
 * Only super_admin (app owner) or group admin can delete rounds.
 * For non-group rounds, only the app owner can delete.
 */
export function canDeleteRound(
  ownerPlayerId: string | null,
  currentPlayerId: string | null,
  memberRole: GroupMemberRole | null,
): boolean {
  return hasPermission(getEffectiveRole(ownerPlayerId, currentPlayerId, memberRole), 'delete_round');
}

/**
 * Check if the current player is the app owner (super_admin).
 * Used for non-group round deletion where there's no group membership context.
 */
export function isAppOwner(
  ownerPlayerId: string | null,
  currentPlayerId: string | null,
): boolean {
  if (!ownerPlayerId || !currentPlayerId) return false;
  return ownerPlayerId === currentPlayerId;
}
