import type { MigrationInterface, QueryRunner } from 'typeorm';
export class LuckyWheel1794910000000 implements MigrationInterface {
  name = 'LuckyWheel1794910000000';
  async up(r: QueryRunner): Promise<void> {
    await r.query(`
CREATE TABLE public.moc_wheel_rounds(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL CHECK(organization_id='00000000-0000-4000-8000-000000000001'),
 opens_at timestamptz NOT NULL,closes_at timestamptz NOT NULL,
 commitment text NOT NULL CHECK(commitment ~ '^[0-9a-f]{64}$'),encrypted_result text NOT NULL CHECK(length(encrypted_result) BETWEEN 80 AND 512),
 status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','SETTLED')),
 result smallint CHECK(result BETWEEN 0 AND 14),nonce text,settled_at timestamptz,
 UNIQUE(id,organization_id),UNIQUE(organization_id,opens_at),
 CHECK(closes_at=opens_at+interval '20 seconds'),
 CHECK((status='OPEN' AND result IS NULL AND nonce IS NULL AND settled_at IS NULL) OR
 (status='SETTLED' AND result IS NOT NULL AND nonce IS NOT NULL AND nonce ~ '^[0-9a-f]{64}$' AND settled_at IS NOT NULL AND settled_at>=closes_at)));
CREATE INDEX wheel_rounds_due ON public.moc_wheel_rounds(closes_at,organization_id) WHERE status='OPEN';
CREATE TABLE public.moc_wheel_bets(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,user_id uuid NOT NULL,round_id uuid NOT NULL,request_id uuid NOT NULL,
 color text NOT NULL CHECK(color IN ('RED','BLACK','GREEN')),stake integer NOT NULL CHECK(stake BETWEEN 1 AND 100),
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','WON','LOST')),payout integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(id,user_id),UNIQUE(organization_id,user_id,round_id),UNIQUE(organization_id,user_id,request_id),
 FOREIGN KEY(user_id) REFERENCES public.users(id),
 FOREIGN KEY(round_id,organization_id) REFERENCES public.moc_wheel_rounds(id,organization_id),
 CHECK((status IN ('PENDING','LOST') AND payout=0) OR (status='WON' AND payout=stake*(CASE WHEN color='GREEN' THEN 14 ELSE 2 END))));
CREATE INDEX wheel_bets_history ON public.moc_wheel_bets(organization_id,user_id,created_at DESC);
CREATE INDEX wheel_bets_round ON public.moc_wheel_bets(organization_id,round_id);
CREATE FUNCTION public.moc_wheel_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_TABLE_NAME='moc_wheel_rounds' THEN
  IF OLD.status<>'OPEN' OR NEW.status<>'SETTLED' OR
   ROW(NEW.id,NEW.organization_id,NEW.opens_at,NEW.closes_at,NEW.commitment,NEW.encrypted_result) IS DISTINCT FROM
   ROW(OLD.id,OLD.organization_id,OLD.opens_at,OLD.closes_at,OLD.commitment,OLD.encrypted_result) THEN RAISE EXCEPTION 'Immutable wheel round'; END IF;
 ELSE
  IF OLD.status<>'PENDING' OR NEW.status NOT IN ('WON','LOST') OR
   ROW(NEW.id,NEW.organization_id,NEW.user_id,NEW.round_id,NEW.request_id,NEW.color,NEW.stake,NEW.created_at) IS DISTINCT FROM
   ROW(OLD.id,OLD.organization_id,OLD.user_id,OLD.round_id,OLD.request_id,OLD.color,OLD.stake,OLD.created_at) THEN RAISE EXCEPTION 'Immutable wheel bet'; END IF;
 END IF;
 RETURN NEW; END $$;
REVOKE ALL ON FUNCTION public.moc_wheel_immutable() FROM PUBLIC;
CREATE TRIGGER wheel_round_immutable BEFORE UPDATE ON public.moc_wheel_rounds FOR EACH ROW EXECUTE FUNCTION public.moc_wheel_immutable();
CREATE TRIGGER wheel_bet_immutable BEFORE UPDATE ON public.moc_wheel_bets FOR EACH ROW EXECUTE FUNCTION public.moc_wheel_immutable();
ALTER TABLE public.moc_wheel_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moc_wheel_bets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.moc_wheel_rounds,public.moc_wheel_bets FROM PUBLIC;
CREATE TABLE public.moc_wheel_ledger(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES public.users(id),
 bet_id uuid NOT NULL,kind text NOT NULL CHECK(kind IN ('WAGER','WIN')),amount integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(bet_id,kind),
 FOREIGN KEY(bet_id,user_id) REFERENCES public.moc_wheel_bets(id,user_id),
 CHECK((kind='WAGER' AND amount BETWEEN -100 AND -1) OR(kind='WIN' AND amount BETWEEN 2 AND 1400)));
CREATE INDEX moc_wheel_ledger_history ON public.moc_wheel_ledger(user_id,created_at DESC);
ALTER TABLE public.moc_wheel_ledger ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION public.moc_wheel_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Preserve wheel history'; END $$;
REVOKE ALL ON FUNCTION public.moc_wheel_no_delete() FROM PUBLIC;
CREATE TRIGGER moc_wheel_ledger_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.moc_wheel_ledger FOR EACH STATEMENT EXECUTE FUNCTION public.moc_wheel_no_delete();
CREATE TRIGGER moc_wheel_round_no_delete BEFORE DELETE OR TRUNCATE ON public.moc_wheel_rounds FOR EACH STATEMENT EXECUTE FUNCTION public.moc_wheel_no_delete();
CREATE TRIGGER moc_wheel_bet_no_delete BEFORE DELETE OR TRUNCATE ON public.moc_wheel_bets FOR EACH STATEMENT EXECUTE FUNCTION public.moc_wheel_no_delete();
REVOKE ALL ON public.moc_wheel_rounds,public.moc_wheel_bets,public.moc_wheel_ledger FROM PUBLIC,anon,authenticated;
`);
  }
  async down(r: QueryRunner): Promise<void> {
    const [row] = (await r.query(
      'SELECT EXISTS(SELECT 1 FROM public.moc_wheel_bets) AS present',
    )) as { present: boolean }[];
    if (!row || row.present) throw Error('Preserve wheel and coin history');
    await r.query(
      'DROP TABLE public.moc_wheel_ledger,public.moc_wheel_bets,public.moc_wheel_rounds; DROP FUNCTION public.moc_wheel_immutable(),public.moc_wheel_no_delete()',
    );
  }
}
