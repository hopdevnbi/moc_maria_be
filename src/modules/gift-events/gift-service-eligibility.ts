import type { EntityManager } from 'typeorm';

/** Only completed service delivery counts, never account age, inquiries or unconfirmed bookings. */
export async function hasCompletedGiftService(
  manager: Pick<EntityManager, 'query'>,
  customerUserId: string,
): Promise<boolean> {
  const [row] = await manager.query<Array<{ completed: boolean }>>(
    `SELECT (
      EXISTS (
        SELECT 1 FROM appointments a
        WHERE a.customer_user_id=$1::uuid AND a.status='COMPLETED'
      )
      OR EXISTS (
        SELECT 1 FROM app_metadata m
        WHERE m.key LIKE 'mocmaria.inquiry.%'
          AND m.value->>'customerId'=$1::text
          AND (m.value->>'status'='COMPLETED' OR m.value->>'fulfillmentStatus'='COMPLETED')
          AND (m.value->>'adminCompletedAt' IS NOT NULL
            OR m.value->>'providerCompletedAt' IS NOT NULL)
      )
    ) AS completed`,
    [customerUserId],
  );
  return row?.completed === true;
}
