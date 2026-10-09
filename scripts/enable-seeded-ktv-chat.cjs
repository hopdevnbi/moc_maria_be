/* eslint-disable @typescript-eslint/no-require-imports */
async function enableSeededChat(client) {
  await client.query('BEGIN');
  try {
    const row = (
      await client.query(
        "SELECT value FROM app_metadata WHERE key='mocmaria.ktv.accounts.v1' FOR UPDATE",
      )
    ).rows[0];
    if (!row || row.value.accounts?.length !== 10)
      throw new Error('Existing ten-account seed required');
    const accounts = row.value.accounts;
    const valid = (
      await client.query(
        `SELECT p.id FROM provider_applications p JOIN users u ON u.id=p.user_id AND u.is_active
      JOIN staff_profiles s ON s.user_id=u.id AND s.is_active WHERE p.id=ANY($1::uuid[])
      AND p.status NOT IN ('REJECTED','SUSPENDED') AND EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.name='THERAPIST')`,
        [accounts.map((a) => a.applicationId)],
      )
    ).rows;
    if (valid.length !== 10) throw new Error('Seed identities must be active THERAPIST accounts');
    const enabled = {
      ...row.value,
      accounts: accounts.map((a) => ({ ...a, chatEnabled: true })),
      chatEnabledBy: 'Owner request 2026-10-10',
    };
    await client.query(
      "UPDATE app_metadata SET value=$1::jsonb,updated_at=now() WHERE key='mocmaria.ktv.accounts.v1'",
      [JSON.stringify(enabled)],
    );
    await client.query(
      "INSERT INTO audit_logs(event,metadata) VALUES('provider.seed_chat.enabled',$1::jsonb)",
      [
        JSON.stringify({
          count: 10,
          authorizedBy: 'Owner request 2026-10-10',
          purpose: 'private service consultation only',
        }),
      ],
    );
    await client.query('COMMIT');
    return { enabled: 10 };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
}
module.exports = { enableSeededChat };
