import type { EntityManager } from 'typeorm';
import type { AuthUserContext } from '../identity/identity.types';

export const SUPPORT_MS = 24 * 60 * 60 * 1000;
export const supportKey = (threadId: string, actorId: string): string =>
  `mocmaria.chat.support.${threadId}.${actorId}`;

export function canSupportChat(actor: AuthUserContext): boolean {
  return (
    actor.isActive !== false &&
    actor.roles?.includes('SUPER_ADMIN') &&
    actor.permissions.includes('admin.portal') &&
    actor.permissions.includes('customers.manage')
  );
}

export async function hasSupportAccess(
  manager: Pick<EntityManager, 'query'>,
  actor: AuthUserContext,
  threadId: string,
): Promise<boolean> {
  if (!canSupportChat(actor)) return false;
  const [grant] = await manager.query<Array<{ allowed: boolean }>>(
    `SELECT true AS allowed FROM app_metadata support
     LEFT JOIN app_metadata privacy ON privacy.key='mocmaria.chat.privacy.'||$2::text
     WHERE support.key=$1 AND support.value->>'actorId'=$3
       AND support.value->>'threadId'=$2
       AND (support.value->>'expiresAt')::timestamptz>clock_timestamp()
       AND NOT COALESCE(privacy.value ? 'passwordHash',false)`,
    [supportKey(threadId, actor.id), threadId, actor.id],
  );
  return grant?.allowed === true;
}
