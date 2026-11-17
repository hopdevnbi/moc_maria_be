import 'reflect-metadata';
import type { Server } from 'node:http';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { buildDatabaseOptionsFromEnv } from '../src/database/database-options';
import { LuckyWheel1794910000000 } from '../src/database/migrations/1794910000000-LuckyWheel';
import { WheelEngine } from '../src/modules/lucky-wheel/wheel-engine';
import {
  createWheelSecret,
  revealWheelSecret,
  wheelColor,
} from '../src/modules/lucky-wheel/wheel-crypto';
import { MOC_WHEEL_SCOPE as scope } from '../src/modules/lucky-wheel/lucky-wheel.service';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/bootstrap/configure-application';

async function main(): Promise<void> {
  const url = new URL(process.env['DATABASE_URL'] ?? '');
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !url.pathname.endsWith('_test')
  )
    throw Error('Disposable loopback *_test database required');
  const db = await new DataSource(buildDatabaseOptionsFromEnv(process.env)).initialize();
  let app: Awaited<ReturnType<typeof NestFactory.create>> | undefined;
  const key = Buffer.from(process.env['MOC_MARIA_WHEEL_RESULT_KEY']!, 'base64url');
  const engine = new WheelEngine(db, key);
  try {
    for (const role of ['anon', 'authenticated']) {
      const found = await db.query<{ rolname: string }[]>(
        'SELECT rolname FROM pg_roles WHERE rolname=$1',
        [role],
      );
      if (!found.length) await db.query(`CREATE ROLE "${role}" NOLOGIN`);
    }
    const migrations = await db.runMigrations({ transaction: 'all' });
    console.log('Full migration chain applied:', migrations.length);
    const runner = db.createQueryRunner();
    await runner.connect();
    await new LuckyWheel1794910000000().down(runner);
    await new LuckyWheel1794910000000().up(runner);
    await runner.release();
    const users = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    for (const [index, id] of users.entries()) {
      await db.query(
        `INSERT INTO users(id,email,display_name,password_hash,is_active,must_change_password) VALUES($1,$2,'Isolated game fixture','not-a-login-password',true,false)`,
        [id, `wheel-${index}@example.invalid`],
      );
      await db.query(
        'INSERT INTO staff_coin_wallets(user_id,balance,total_earned) VALUES($1,$2,$2)',
        [id, index === 3 ? 0 : 100],
      );
    }
    let [clock] = await db.query<{ now: Date }[]>('SELECT clock_timestamp() AS now');
    const remaining = 20000 - (clock.now.getTime() % 20000);
    if (remaining < 5000) {
      await new Promise((resolve) => setTimeout(resolve, remaining + 50));
      [clock] = await db.query<{ now: Date }[]>('SELECT clock_timestamp() AS now');
    }
    const opensAt = new Date(Math.floor(clock.now.getTime() / 20000) * 20000);
    const roundId = randomUUID(),
      context = { organizationId: scope, id: roundId, opensAt };
    // Test-only deterministic green fixture; the production engine always uses cryptographic randomness.
    let secret = createWheelSecret(key, context);
    while (revealWheelSecret(key, context, secret.encrypted, secret.commitment).number !== 0)
      secret = createWheelSecret(key, context);
    await db.query(
      'INSERT INTO moc_wheel_rounds(id,organization_id,opens_at,closes_at,commitment,encrypted_result) VALUES($1,$2,$3,$4,$5,$6)',
      [
        roundId,
        scope,
        opensAt,
        new Date(opensAt.getTime() + 20000),
        secret.commitment,
        secret.encrypted,
      ],
    );
    const input = { roundId, requestId: randomUUID(), color: 'GREEN' as const, stake: 10 };
    const replies = await Promise.all([
      engine.bet(scope, users[0], input),
      engine.bet(scope, users[0], input),
    ]);
    assert.equal(replies.filter((r) => r.replayed).length, 1);
    assert.equal(replies[0].wallet.balance, 90);
    await assert.rejects(
      engine.bet(scope, users[0], { ...input, stake: 11 }),
      /WHEEL_REQUEST_CONFLICT/,
    );
    await assert.rejects(
      engine.bet(scope, users[0], { ...input, requestId: randomUUID() }),
      /WHEEL_ALREADY_BET/,
    );
    await assert.rejects(
      engine.bet(scope, users[3], { ...input, requestId: randomUUID() }),
      /WHEEL_INSUFFICIENT_COINS/,
    );
    await engine.bet(scope, users[1], { ...input, requestId: randomUUID(), color: 'RED' });
    // Coordinate the existing attendance reversal's conditional UPDATE against a game debit.
    await db.query('UPDATE staff_coin_wallets SET balance=5,total_earned=5 WHERE user_id=$1', [
      users[2],
    ]);
    const race = await Promise.allSettled([
      engine.bet(scope, users[2], { ...input, requestId: randomUUID(), color: 'BLACK', stake: 5 }),
      db.query(
        'UPDATE staff_coin_wallets SET balance=balance-5,total_earned=total_earned-5 WHERE user_id=$1 AND balance>=5 AND total_earned>=5 RETURNING user_id',
        [users[2]],
      ),
    ]);
    const [wallet] = await db.query<{ balance: number }[]>(
      'SELECT balance FROM staff_coin_wallets WHERE user_id=$1',
      [users[2]],
    );
    assert.equal(wallet.balance, 0);
    assert.ok(race.some((r) => r.status === 'fulfilled'));
    const state = await engine.state(scope, users[0]);
    assert.equal(state.bet?.stake, 10);
    assert.equal(state.wallet.balance, 90);
    assert.ok(!('number' in state.round));
    assert.ok(!('encrypted_result' in state.round));
    await assert.rejects(
      db.query('UPDATE moc_wheel_rounds SET commitment=$2 WHERE id=$1', [roundId, 'a'.repeat(64)]),
      /Immutable/,
    );
    await assert.rejects(
      db.query('DELETE FROM moc_wheel_bets WHERE user_id=$1', [users[0]]),
      /Preserve/,
    );
    await assert.rejects(
      db.query('UPDATE moc_wheel_ledger SET amount=0 WHERE user_id=$1', [users[0]]),
      /Preserve/,
    );
    await assert.rejects(new LuckyWheel1794910000000().down(db.createQueryRunner()), /Preserve/);
    for (const table of ['moc_wheel_rounds', 'moc_wheel_bets', 'moc_wheel_ledger']) {
      const [permissions] = await db.query<{ exposed: boolean }[]>(
        `SELECT has_table_privilege('anon',$1,'SELECT') OR has_table_privilege('authenticated',$1,'SELECT') AS exposed`,
        [table],
      );
      assert.equal(permissions.exposed, false);
    }
    const wait = opensAt.getTime() + 20000 - Date.now() + 100;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    // Two replica-like engines settling concurrently/repeatedly must credit once.
    await Promise.all([engine.settleDue(), new WheelEngine(db, key).settleDue()]);
    await engine.settleDue();
    const settled = await engine.state(scope, users[0]);
    assert.equal(settled.wallet.balance, 230);
    assert.equal(settled.wallet.totalEarned, 100);
    assert.equal(settled.myBets[0]?.payout, 140);
    assert.equal(settled.myBets[0]?.number, 0);
    assert.equal((await engine.state(scope, users[1])).wallet.balance, 90);
    const [{ count }] = await db.query<{ count: string }[]>(
      "SELECT count(*) FROM moc_wheel_ledger WHERE user_id=$1 AND kind='WIN'",
      [users[0]],
    );
    assert.equal(count, '1');
    assert.equal(wheelColor(0), 'GREEN');
    assert.equal(wheelColor(13), 'RED');
    assert.equal(wheelColor(14), 'BLACK');
    // Run real Mộc guard + fresh session/active-user checks through the HTTP boundary.
    app = await NestFactory.create(AppModule, { logger: false });
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
    const address = (app.getHttpServer() as Server).address() as { port: number };
    const api = `http://127.0.0.1:${address.port}/api/v1/games/wheel`;
    const session = randomUUID();
    await db.query(
      "INSERT INTO refresh_sessions(id,user_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      [session, users[0], randomBytes(32).toString('hex')],
    );
    const token = await app.get(JwtService).signAsync({ sub: users[0], sid: session });
    const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
    assert.equal((await fetch(api)).status, 401);
    const response = await fetch(api, { headers });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control') ?? '', /no-store/);
    const current = (await response.json()) as { round: { id: string } };
    const acceptedInput = {
      roundId: current.round.id,
      requestId: randomUUID(),
      color: 'RED',
      stake: 1,
    };
    const acceptedResponse = await fetch(api + '/bets', {
      method: 'POST',
      headers,
      body: JSON.stringify(acceptedInput),
    });
    assert.equal(acceptedResponse.status, 201);
    const accepted = (await acceptedResponse.json()) as {
      bet: { requestId: string };
      wallet: { balance: number };
    };
    assert.equal(accepted.bet.requestId, acceptedInput.requestId);
    assert.equal(accepted.wallet.balance, 229);
    const replayResponse = await fetch(api + '/bets', {
      method: 'POST',
      headers,
      body: JSON.stringify(acceptedInput),
    });
    assert.equal(replayResponse.status, 201);
    const replay = (await replayResponse.json()) as {
      replayed: boolean;
      wallet: { balance: number };
    };
    assert.equal(replay.replayed, true);
    assert.equal(replay.wallet.balance, 229);
    assert.equal(
      (
        await fetch(api + '/bets', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            roundId: current.round.id,
            requestId: randomUUID(),
            color: 'RED',
            stake: 1,
            number: 0,
          }),
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(api + '/bets', {
          method: 'POST',
          headers: { ...headers, Origin: 'https://untrusted.example' },
          body: JSON.stringify({
            roundId: current.round.id,
            requestId: randomUUID(),
            color: 'RED',
            stake: 1,
          }),
        })
      ).status,
      403,
    );
    await db.query('UPDATE users SET must_change_password=true WHERE id=$1', [users[0]]);
    assert.equal(
      (
        await fetch(api + '/bets', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            roundId: current.round.id,
            requestId: randomUUID(),
            color: 'RED',
            stake: 1,
          }),
        })
      ).status,
      403,
    );
    await db.query('UPDATE refresh_sessions SET revoked_at=now() WHERE id=$1', [session]);
    assert.equal((await fetch(api, { headers })).status, 401);
    console.log(
      'PASS: migration up/down, wallet debit/reversal race, replay, green 14x, loss, multi-replica settlement, immutable history, RLS, HTTP auth/DTO/origin/password/revocation.',
    );
  } finally {
    if (app) await app.close();
    await db.destroy();
  }
}
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Isolated wheel tests failed');
  process.exitCode = 1;
});
