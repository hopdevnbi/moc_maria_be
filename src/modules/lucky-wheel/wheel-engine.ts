import { ConflictException, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
import {
  createWheelSecret,
  revealWheelSecret,
  wheelColor,
  WHEEL_MAX_STAKE,
  WHEEL_PERIOD_MS,
  type WheelColor,
} from './wheel-crypto';

type Round = {
  id: string;
  organization_id: string;
  opens_at: Date;
  closes_at: Date;
  commitment: string;
  encrypted_result: string;
  status: 'OPEN' | 'SETTLED';
  result: number | null;
  nonce: string | null;
  settled_at: Date | null;
};
type Bet = {
  id: string;
  round_id: string;
  request_id: string;
  color: WheelColor;
  stake: number;
  payout: number;
  status: 'PENDING' | 'WON' | 'LOST';
  created_at: Date;
};
export type WheelBetInput = {
  roundId: string;
  requestId: string;
  color: WheelColor;
  stake: number;
};
type PublicBet = {
  id: string;
  roundId: string;
  requestId: string;
  color: WheelColor;
  stake: number;
  payout: number;
  status: Bet['status'];
  createdAt: string;
};
type Wallet = { balance: number; totalEarned: number };
type Snapshot = {
  serverTime: Date;
  round: PublicRound | null;
  bet: PublicBet | null;
  wallet: Wallet;
  results: (PublicRound & { number: number; nonce: string })[];
  myBets: (PublicBet & PublicRound & { number: number | null; nonce: string | null })[];
  needsSync: boolean;
};
export type WheelState = {
  organizationId: string;
  serverTime: string;
  round: PublicRound;
  bet: PublicBet | null;
  wallet: Wallet;
  results: (PublicRound & { number: number; nonce: string; color: WheelColor })[];
  myBets: Snapshot['myBets'];
  rules: {
    periodSeconds: number;
    maxStake: number;
    minStake: number;
    red: number;
    black: number;
    green: number;
    version: string;
  };
};
export type WheelAcceptance = { bet: PublicBet; wallet: Wallet; replayed: boolean };
const publicBet = (b: Bet): PublicBet => ({
  id: b.id,
  roundId: b.round_id,
  requestId: b.request_id,
  color: b.color,
  stake: b.stake,
  payout: b.payout,
  status: b.status,
  createdAt: b.created_at.toISOString(),
});
type PublicRound = { id: string; opensAt: string; closesAt: string; commitment: string };

/** Game transitions serialize across replicas; wallet UPDATE/row locks also coordinate attendance credits and reversals. */
export class WheelEngine {
  constructor(
    private readonly db: DataSource,
    private readonly key: Buffer,
  ) {}
  private async transaction<T>(
    org: string,
    action: (m: EntityManager, now: Date) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (m) => {
      await m.query("SELECT pg_advisory_xact_lock(hashtext('moc-maria-wheel-v1'),hashtext($1))", [
        org,
      ]);
      const [clock] = await m.query<{ now: Date }[]>('SELECT clock_timestamp() AS now');
      if (!clock) throw Error('WHEEL_CLOCK_UNAVAILABLE');
      return action(m, clock.now);
    });
  }
  private async wallet(m: EntityManager, _org: string, user: string): Promise<Wallet> {
    const [row] = await m.query<{ balance: number; totalEarned: number }[]>(
      `SELECT coalesce(w.balance,0) AS balance,coalesce(w.total_earned,0) AS "totalEarned" FROM (VALUES($1::uuid)) u(id) LEFT JOIN public.staff_coin_wallets w ON w.user_id=u.id`,
      [user],
    );
    if (!row || !Number.isSafeInteger(row.balance) || !Number.isSafeInteger(row.totalEarned))
      throw Error('WHEEL_WALLET_RANGE');
    return row;
  }
  private async settle(m: EntityManager, org: string, now: Date): Promise<void> {
    const rows = await m.query<Round[]>(
      "SELECT * FROM public.moc_wheel_rounds WHERE organization_id=$1 AND status='OPEN' AND closes_at<=$2 ORDER BY closes_at LIMIT 30 FOR UPDATE",
      [org, now],
    );
    for (const r of rows) {
      const { number, nonce } = revealWheelSecret(
        this.key,
        { organizationId: org, id: r.id, opensAt: r.opens_at },
        r.encrypted_result,
        r.commitment,
      );
      const color = wheelColor(number);
      await m.query(
        `UPDATE public.moc_wheel_bets SET status=CASE WHEN color=$3 THEN 'WON' ELSE 'LOST' END,payout=CASE WHEN color=$3 THEN stake*(CASE WHEN color='GREEN' THEN 14 ELSE 2 END) ELSE 0 END WHERE organization_id=$1 AND round_id=$2 AND status='PENDING'`,
        [org, r.id, color],
      );
      const winners = await m.query<{ id: string; user_id: string; payout: number }[]>(
        "SELECT id,user_id,payout FROM public.moc_wheel_bets WHERE organization_id=$1 AND round_id=$2 AND status='WON' ORDER BY user_id",
        [org, r.id],
      );
      for (const winner of winners) {
        const credited = await m.query<{ user_id: string }[]>(
          `UPDATE public.staff_coin_wallets SET balance=balance+$2,updated_at=clock_timestamp() WHERE user_id=$1 AND balance<=2147483647-$2 RETURNING user_id`,
          [winner.user_id, winner.payout],
        );
        if (!credited.length) throw Error('WHEEL_WALLET_RANGE');
        await m.query(
          `INSERT INTO public.moc_wheel_ledger(user_id,bet_id,kind,amount) VALUES($1,$2,'WIN',$3)`,
          [winner.user_id, winner.id, winner.payout],
        );
      }
      await m.query(
        "UPDATE public.moc_wheel_rounds SET status='SETTLED',result=$3,nonce=$4,settled_at=$5 WHERE organization_id=$1 AND id=$2 AND status='OPEN'",
        [org, r.id, number, nonce, now],
      );
    }
  }
  private async current(m: EntityManager, org: string, now: Date): Promise<Round> {
    const start = Math.floor(now.getTime() / WHEEL_PERIOD_MS) * WHEEL_PERIOD_MS;
    // Persist current and next commitments before accepting any wagers.
    for (const ms of [start, start + WHEEL_PERIOD_MS]) {
      const opens = new Date(ms);
      const [existing] = await m.query<{ id: string }[]>(
        'SELECT id FROM public.moc_wheel_rounds WHERE organization_id=$1 AND opens_at=$2',
        [org, opens],
      );
      if (!existing) {
        const id = randomUUID(),
          secret = createWheelSecret(this.key, { organizationId: org, id, opensAt: opens });
        await m.query(
          'INSERT INTO public.moc_wheel_rounds(id,organization_id,opens_at,closes_at,commitment,encrypted_result) VALUES($1,$2,$3,$4,$5,$6)',
          [id, org, opens, new Date(ms + WHEEL_PERIOD_MS), secret.commitment, secret.encrypted],
        );
      }
    }
    const [row] = await m.query<Round[]>(
      'SELECT * FROM public.moc_wheel_rounds WHERE organization_id=$1 AND opens_at=$2',
      [org, new Date(start)],
    );
    return row;
  }
  private readonly syncing = new Map<string, Promise<void>>();
  private async snapshot(org: string, user: string): Promise<Snapshot> {
    const round = (a: string): string =>
      `jsonb_build_object('id',${a}.id,'opensAt',${a}.opens_at,'closesAt',${a}.closes_at,'commitment',${a}.commitment)`;
    const bet = (a: string): string =>
      `jsonb_build_object('id',${a}.id,'roundId',${a}.round_id,'requestId',${a}.request_id,'color',${a}.color,'stake',${a}.stake,'payout',${a}.payout,'status',${a}.status,'createdAt',${a}.created_at)`;
    const [row] = await this.db.query<Snapshot[]>(
      `
      WITH clock AS MATERIALIZED(SELECT clock_timestamp() AS now),slot AS(SELECT now,to_timestamp(floor(extract(epoch FROM now)/20)*20) AS start FROM clock)
      SELECT c.now AS "serverTime",CASE WHEN r.id IS NULL THEN NULL ELSE ${round('r')} END AS round,
      (SELECT ${bet('b')} FROM public.moc_wheel_bets b WHERE b.organization_id=$1 AND b.user_id=$2 AND b.round_id=r.id) AS bet,
      (SELECT jsonb_build_object('balance',coalesce(w.balance,0),'totalEarned',coalesce(w.total_earned,0)) FROM (VALUES($2::uuid)) u(id) LEFT JOIN public.staff_coin_wallets w ON w.user_id=u.id) AS wallet,
      coalesce((SELECT jsonb_agg(obj) FROM(SELECT ${round('h')} || jsonb_build_object('number',h.result,'nonce',h.nonce) AS obj FROM public.moc_wheel_rounds h WHERE h.organization_id=$1 AND h.status='SETTLED' ORDER BY h.closes_at DESC LIMIT 12)q),'[]'::jsonb) AS results,
      coalesce((SELECT jsonb_agg(obj) FROM(SELECT ${bet('b')} || jsonb_build_object('number',h.result,'nonce',h.nonce,'commitment',h.commitment,'opensAt',h.opens_at,'closesAt',h.closes_at) AS obj FROM public.moc_wheel_bets b JOIN public.moc_wheel_rounds h ON h.id=b.round_id AND h.organization_id=b.organization_id WHERE b.organization_id=$1 AND b.user_id=$2 ORDER BY b.created_at DESC LIMIT 15)q),'[]'::jsonb) AS "myBets",
      (r.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.moc_wheel_rounds n WHERE n.organization_id=$1 AND n.opens_at=c.start+interval '20 seconds') OR EXISTS(SELECT 1 FROM public.moc_wheel_rounds d WHERE d.organization_id=$1 AND d.status='OPEN' AND d.closes_at<=c.now)) AS "needsSync"
      FROM slot c LEFT JOIN public.moc_wheel_rounds r ON r.organization_id=$1 AND r.opens_at=c.start`,
      [org, user],
    );
    if (!row) throw Error('WHEEL_SNAPSHOT_UNAVAILABLE');
    return row;
  }
  async state(org: string, user: string): Promise<WheelState> {
    let row = await this.snapshot(org, user);
    if (row.needsSync) {
      let pending = this.syncing.get(org);
      if (!pending) {
        pending = this.transaction(org, async (m, now) => {
          await this.settle(m, org, now);
          await this.current(m, org, now);
        }).finally(() => {
          this.syncing.delete(org);
        });
        this.syncing.set(org, pending);
      }
      await pending;
      row = await this.snapshot(org, user);
    }
    if (!row.round) throw Error('WHEEL_ROUND_UNAVAILABLE');
    if (!Number.isSafeInteger(row.wallet.balance) || !Number.isSafeInteger(row.wallet.totalEarned))
      throw Error('WHEEL_WALLET_RANGE');
    const normalize = <T extends PublicRound>(r: T): T => ({
      ...r,
      opensAt: new Date(r.opensAt).toISOString(),
      closesAt: new Date(r.closesAt).toISOString(),
    });
    return {
      organizationId: org,
      serverTime: row.serverTime.toISOString(),
      round: normalize(row.round),
      bet: row.bet,
      wallet: row.wallet,
      results: row.results.map((r) => ({ ...normalize(r), color: wheelColor(r.number) })),
      myBets: row.myBets.map(normalize),
      rules: {
        periodSeconds: 20,
        maxStake: WHEEL_MAX_STAKE,
        minStake: 1,
        red: 2,
        black: 2,
        green: 14,
        version: 'wheel-v1',
      },
    };
  }
  async bet(
    org: string,
    user: string,
    input: WheelBetInput,
    reauthorize?: (m: EntityManager) => Promise<void>,
  ): Promise<WheelAcceptance> {
    if (
      !Number.isInteger(input.stake) ||
      input.stake < 1 ||
      input.stake > WHEEL_MAX_STAKE ||
      !['RED', 'BLACK', 'GREEN'].includes(input.color)
    )
      throw new BadRequestException('WHEEL_INVALID_BET');
    return this.transaction(org, async (m, now) => {
      await m.query('SELECT id FROM public.users WHERE id=$1 FOR UPDATE', [user]);
      await reauthorize?.(m);
      const [replay] = await m.query<Bet[]>(
        'SELECT * FROM public.moc_wheel_bets WHERE organization_id=$1 AND user_id=$2 AND request_id=$3',
        [org, user, input.requestId],
      );
      if (replay) {
        if (
          replay.round_id !== input.roundId ||
          replay.color !== input.color ||
          replay.stake !== input.stake
        )
          throw new ConflictException('WHEEL_REQUEST_CONFLICT');
        return { bet: publicBet(replay), wallet: await this.wallet(m, org, user), replayed: true };
      }
      const [round] = await m.query<Round[]>(
        'SELECT * FROM public.moc_wheel_rounds WHERE organization_id=$1 AND id=$2',
        [org, input.roundId],
      );
      // DB time is obtained again after potentially waiting on auth/user locks.
      const [clock] = await m.query<{ now: Date }[]>('SELECT clock_timestamp() AS now');
      if (!clock) throw Error('WHEEL_CLOCK_UNAVAILABLE');
      now = clock.now;
      if (!round || round.status !== 'OPEN' || round.opens_at > now || round.closes_at <= now)
        throw new ConflictException('WHEEL_ROUND_CLOSED');
      const [existing] = await m.query<{ id: string }[]>(
        'SELECT id FROM public.moc_wheel_bets WHERE organization_id=$1 AND user_id=$2 AND round_id=$3',
        [org, user, input.roundId],
      );
      if (existing) throw new ConflictException('WHEEL_ALREADY_BET');
      await m.query(
        'INSERT INTO public.staff_coin_wallets(user_id,balance,total_earned) VALUES($1,0,0) ON CONFLICT(user_id) DO NOTHING',
        [user],
      );
      await m.query('SELECT user_id FROM public.staff_coin_wallets WHERE user_id=$1 FOR UPDATE', [
        user,
      ]);
      const wallet = await this.wallet(m, org, user);
      if (wallet.balance < input.stake) throw new ConflictException('WHEEL_INSUFFICIENT_COINS');
      const id = randomUUID();
      const [bet] = await m.query<Bet[]>(
        `WITH acceptance AS MATERIALIZED(SELECT clock_timestamp() AS now)
        INSERT INTO public.moc_wheel_bets(id,organization_id,user_id,round_id,request_id,color,stake,created_at)
        SELECT $1,$2,$3,r.id,$5,$6,$7,a.now FROM public.moc_wheel_rounds r CROSS JOIN acceptance a WHERE r.id=$4 AND r.organization_id=$2 AND r.status='OPEN' AND r.opens_at<=a.now AND r.closes_at>a.now RETURNING *`,
        [id, org, user, input.roundId, input.requestId, input.color, input.stake],
      );
      if (!bet) throw new ConflictException('WHEEL_ROUND_CLOSED');
      const debited = await m.query<{ user_id: string }[]>(
        `UPDATE public.staff_coin_wallets SET balance=balance-$2,updated_at=clock_timestamp() WHERE user_id=$1 AND balance>=$2 RETURNING user_id`,
        [user, input.stake],
      );
      if (!debited.length) throw new ConflictException('WHEEL_INSUFFICIENT_COINS');
      await m.query(
        "INSERT INTO public.moc_wheel_ledger(user_id,bet_id,kind,amount) VALUES($1,$2,'WAGER',$3)",
        [user, id, -input.stake],
      );
      return { bet: publicBet(bet), wallet: await this.wallet(m, org, user), replayed: false };
    });
  }
  async settleDue(): Promise<void> {
    const orgs = await this.db.query<{ organization_id: string }[]>(
      "SELECT organization_id FROM public.moc_wheel_rounds WHERE status='OPEN' AND closes_at<=clock_timestamp() GROUP BY organization_id ORDER BY min(closes_at) LIMIT 20",
    );
    for (const { organization_id: org } of orgs)
      await this.transaction(org, (m, now) => this.settle(m, org, now));
  }
}
