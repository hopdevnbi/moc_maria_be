// Operator smoke check. Credentials/tokens stay in memory; the temporary user is removed.
require('dotenv').config({ quiet: true });
const { randomBytes, randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { Client } = require('pg');
const base = 'https://api.mocmaria.com/api/v1';
const email = `smoke-${randomUUID()}@mocmaria.test`;
const password = 'Aa1!' + randomBytes(32).toString('base64url');
let userId;
let cookie;
const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: true,
    ca: readFileSync('deploy/certificates/supabase-ca.crt', 'utf8'),
  },
});
function check(value, label) {
  if (!value) throw new Error(label + ' FAILED');
  console.log(label + ' PASS');
}
async function call(path, method = 'GET', body, token, useCookie = true) {
  return fetch(base + path, {
    method,
    headers: {
      Origin: 'https://mocmaria.com',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(cookie && useCookie ? { Cookie: cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
}
async function main() {
  await client.connect();
  try {
    const registration = await call('/auth/register', 'POST', {
      displayName: 'Mộc Maria QA smoke',
      email,
      password,
    });
    if (registration.status !== 201) throw new Error('Registration status ' + registration.status);
    const auth = await registration.json();
    userId = auth.user.id;
    const setCookie = registration.headers.get('set-cookie') || '';
    check(
      setCookie.includes('HttpOnly') &&
        setCookie.includes('Secure') &&
        setCookie.includes('SameSite=Lax'),
      'SECURE_COOKIE',
    );
    cookie = setCookie.split(';')[0];
    check(auth.user.roles.length === 1 && auth.user.roles[0] === 'CUSTOMER', 'REGISTER_ROLE');
    check((await call('/auth/me', 'GET', undefined, auth.accessToken)).status === 200, 'AUTH_ME');
    check(
      (await call('/admin/provider-applications', 'GET', undefined, auth.accessToken)).status ===
        403,
      'CUSTOMER_RBAC',
    );
    check(
      (
        await call(
          '/auth/login',
          'POST',
          { identifier: email, password: 'Invalid' },
          undefined,
          false,
        )
      ).status === 401,
      'INVALID_PASSWORD',
    );
    const oldCookie = cookie;
    const refresh = await call('/auth/refresh', 'POST');
    check(refresh.status === 200, 'REFRESH');
    const renewed = await refresh.json();
    cookie = (refresh.headers.get('set-cookie') || '').split(';')[0];
    check(cookie !== oldCookie, 'REFRESH_ROTATION');
    const currentCookie = cookie;
    cookie = oldCookie;
    check((await call('/auth/refresh', 'POST')).status === 401, 'REFRESH_REPLAY_REJECTED');
    cookie = currentCookie;
    check((await call('/auth/logout', 'POST')).status === 204, 'LOGOUT');
    check(
      (await call('/auth/me', 'GET', undefined, renewed.accessToken, false)).status === 401,
      'LOGOUT_ACCESS_REVOKED',
    );
    cookie = undefined;
    const login = await call('/auth/login', 'POST', { identifier: email, password });
    check(login.status === 200, 'LOGIN');
    cookie = (login.headers.get('set-cookie') || '').split(';')[0];
    check((await call('/auth/logout', 'POST')).status === 204, 'LOGIN_LOGOUT');
  } finally {
    // The exact random email is retained even if registration succeeded but parsing failed.
    await client.query('BEGIN');
    try {
      const row = await client.query('SELECT id FROM users WHERE email=$1', [email]);
      if (row.rows.length) {
        const id = row.rows[0].id;
        if (userId && id !== userId) throw new Error('Cleanup identity mismatch');
        await client.query('DELETE FROM audit_logs WHERE actor_user_id=$1 OR target_user_id=$1', [
          id,
        ]);
        await client.query('DELETE FROM users WHERE id=$1 AND email=$2', [id, email]);
      }
      await client.query('COMMIT');
      console.log('SMOKE_FIXTURE_CLEANUP PASS');
    } catch {
      await client.query('ROLLBACK');
      throw new Error('Smoke cleanup failed; operator must check fixture ownership');
    }
    await client.end();
  }
}
main().catch((error) => {
  // Never print response bodies, cookies, tokens, connection strings or DB error details.
  console.error(
    /^\w[\w _-]*(?:status \d+)?$/.test(error.message) ? error.message : 'AUTH_SMOKE FAILED',
  );
  process.exitCode = 1;
});
