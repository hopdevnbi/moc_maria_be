import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { AuthUserContext } from '../identity/identity.types';
import { GiftEventsService } from './gift-events.service';

export type PrizeReport = {
  id: string;
  name: string;
  kind: string;
  stockTotal: number;
  stockIssued: number;
  actualIssued: number;
  redeemed: number;
  expired: number;
  liabilityVnd: number;
  stockDelta: number;
};
export type GiftReport = {
  eventId: string;
  code: string;
  title: string;
  status: string;
  generatedAt: string;
  timezone: 'Asia/Ho_Chi_Minh';
  entries: number;
  issued: number;
  redeemed: number;
  expired: number;
  voided: number;
  outstanding: number;
  redemptionHistory: number;
  budgetCapVnd: number;
  budgetReservedVnd: number;
  liabilityIssuedVnd: number;
  discrepancies: string[];
  reconciled: boolean;
  prizes: PrizeReport[];
  branches: Array<{ id: string; name: string; redeemed: number }>;
  daily: Array<{ day: string; issued: number }>;
};

export function safeCsvCell(value: string | number | null | undefined): string {
  const raw = String(value ?? '').replace(/[\t\r\n]/g, ' ');
  const safe = /^\s*[=+@-]/.test(raw) ? "'" + raw : raw;
  return '"' + safe.replace(/"/g, '""') + '"';
}
export function giftReportCsv(report: GiftReport): string {
  const rows: (string | number)[][] = [
    ['Event', report.code, report.title],
    ['Time zone', report.timezone, report.generatedAt],
    ['Entries', report.entries],
    ['Issued', report.issued],
    ['Redeemed', report.redeemed],
    ['Expired', report.expired],
    ['Voided', report.voided],
    ['Outstanding', report.outstanding],
    ['Budget VND', report.budgetCapVnd],
    ['Reserved VND', report.budgetReservedVnd],
    ['Issued liability VND', report.liabilityIssuedVnd],
    ['Reconciliation', report.reconciled ? 'PASS' : 'DISCREPANCY', report.discrepancies.join('; ')],
    [
      'Prize ID',
      'Prize',
      'Kind',
      'Total Stock',
      'Stock Issued',
      'Actual Issued',
      'Redeemed',
      'Expired',
      'Liability VND',
      'Stock Delta',
    ],
    ...report.prizes.map((p) => [
      p.id,
      p.name,
      p.kind,
      p.stockTotal,
      p.stockIssued,
      p.actualIssued,
      p.redeemed,
      p.expired,
      p.liabilityVnd,
      p.stockDelta,
    ]),
    ['Branch ID', 'Branch', 'Redeemed'],
    ...report.branches.map((b) => [b.id, b.name, b.redeemed]),
    ['Day (Asia/Ho_Chi_Minh)', 'Issued'],
    ...report.daily.map((d) => [d.day, d.issued]),
  ];
  return '\uFEFF' + rows.map((r) => r.map(safeCsvCell).join(',')).join('\r\n') + '\r\n';
}

@Injectable()
export class GiftReportService {
  constructor(
    private readonly db: DataSource,
    private readonly events: GiftEventsService,
  ) {}
  async report(actor: AuthUserContext, eventId: string): Promise<GiftReport> {
    this.events.requireAdmin(actor);
    this.events.requireEnabled();
    return this.db.transaction('REPEATABLE READ', async (m) => {
      const [event] = await m.query<
        Array<{
          id: string;
          code: string;
          title: string;
          status: string;
          budget_cap_vnd: string;
          budget_reserved_vnd: string;
        }>
      >(
        'SELECT id,code,title,status,budget_cap_vnd,budget_reserved_vnd FROM gift_event_campaigns WHERE id=$1::uuid',
        [eventId],
      );
      if (!event) throw new NotFoundException('EVENT_NOT_FOUND');
      const [totals] = await m.query<
        Array<{
          entries: string;
          issued: string;
          redeemed: string;
          expired: string;
          voided: string;
          outstanding: string;
          liability: string;
          history: string;
        }>
      >(
        `SELECT
        (SELECT COUNT(*) FROM gift_event_entries WHERE event_id=$1::uuid)::text entries,
        COUNT(*)::text issued,
        COUNT(*) FILTER(WHERE status='REDEEMED')::text redeemed,
        COUNT(*) FILTER(WHERE status='EXPIRED' OR (status='ISSUED' AND expires_at<=now()))::text expired,
        COUNT(*) FILTER(WHERE status='VOIDED')::text voided,
        COUNT(*) FILTER(WHERE status='ISSUED' AND expires_at>now())::text outstanding,
        COALESCE(SUM((reward_snapshot->>'liabilityVnd')::bigint),0)::text liability,
        (SELECT COUNT(*) FROM gift_event_redemption_history h
          JOIN gift_event_rewards rr ON rr.id=h.reward_id
          WHERE rr.event_id=$1::uuid AND h.action='REDEEM')::text history
        FROM gift_event_rewards WHERE event_id=$1::uuid`,
        [eventId],
      );
      const prizeRows = await m.query<
        Array<{
          id: string;
          name: string;
          kind: string;
          stock_total: number;
          stock_issued: number;
          issued: string;
          redeemed: string;
          expired: string;
          liability: string;
        }>
      >(
        `SELECT
        p.id,p.name,p.kind,p.stock_total,p.stock_issued,
        COUNT(r.id)::text issued,COUNT(r.id) FILTER(WHERE r.status='REDEEMED')::text redeemed,
        COUNT(r.id) FILTER(WHERE r.status='EXPIRED' OR
          (r.status='ISSUED' AND r.expires_at<=now()))::text expired,
        COALESCE(SUM((r.reward_snapshot->>'liabilityVnd')::bigint),0)::text liability
        FROM gift_event_prizes p LEFT JOIN gift_event_rewards r ON r.prize_id=p.id
        WHERE p.event_id=$1::uuid GROUP BY p.id ORDER BY p.name`,
        [eventId],
      );
      const branchRows = await m.query<Array<{ id: string; name: string; n: string }>>(
        `SELECT b.id,b.name,
        COUNT(*)::text n FROM gift_event_rewards r
        JOIN branches b ON b.id=r.redeemed_branch_id
        WHERE r.event_id=$1::uuid AND r.status='REDEEMED'
        GROUP BY b.id,b.name ORDER BY n DESC,b.name`,
        [eventId],
      );
      const dailyRows = await m.query<Array<{ day: string; n: string }>>(
        `SELECT
        TO_CHAR(issued_at AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM-DD') day,
        COUNT(*)::text n FROM gift_event_rewards WHERE event_id=$1::uuid
        GROUP BY day ORDER BY day`,
        [eventId],
      );
      const entries = Number(totals.entries),
        issued = Number(totals.issued),
        redeemed = Number(totals.redeemed),
        expired = Number(totals.expired),
        voided = Number(totals.voided),
        outstanding = Number(totals.outstanding),
        redemptionHistory = Number(totals.history),
        liabilityIssuedVnd = Number(totals.liability),
        budgetReservedVnd = Number(event.budget_reserved_vnd);
      const prizes: PrizeReport[] = prizeRows.map((p) => {
        const actualIssued = Number(p.issued),
          stockIssued = Number(p.stock_issued);
        return {
          id: p.id,
          name: p.name,
          kind: p.kind,
          stockTotal: Number(p.stock_total),
          stockIssued,
          actualIssued,
          redeemed: Number(p.redeemed),
          expired: Number(p.expired),
          liabilityVnd: Number(p.liability),
          stockDelta: stockIssued - actualIssued,
        };
      });
      const discrepancies: string[] = [];
      if (entries !== issued) discrepancies.push('ENTRY_REWARD_MISMATCH');
      if (issued !== redeemed + expired + voided + outstanding)
        discrepancies.push('REWARD_STATUS_MISMATCH');
      if (prizes.some((p) => p.stockDelta !== 0)) discrepancies.push('PRIZE_STOCK_MISMATCH');
      if (redemptionHistory !== redeemed) discrepancies.push('REDEEM_HISTORY_MISMATCH');
      if (budgetReservedVnd !== liabilityIssuedVnd) discrepancies.push('LIABILITY_BUDGET_MISMATCH');
      return {
        eventId: event.id,
        code: event.code,
        title: event.title,
        status: event.status,
        generatedAt: new Date().toISOString(),
        timezone: 'Asia/Ho_Chi_Minh',
        entries,
        issued,
        redeemed,
        expired,
        voided,
        outstanding,
        redemptionHistory,
        budgetCapVnd: Number(event.budget_cap_vnd),
        budgetReservedVnd,
        liabilityIssuedVnd,
        discrepancies,
        reconciled: discrepancies.length === 0,
        prizes,
        branches: branchRows.map((b) => ({ id: b.id, name: b.name, redeemed: Number(b.n) })),
        daily: dailyRows.map((d) => ({ day: d.day, issued: Number(d.n) })),
      };
    });
  }
}
