import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { AuthUserContext } from '../identity/identity.types';
import { inquiryStateSql } from '../customer-experience/inquiry-state';

export type DashboardPeriod = 'day' | 'month' | 'year';
export type DashboardRange = { period: DashboardPeriod; from: string; to: string; label: string };
export type DashboardProvider = {
  id: string;
  name: string;
  status: string;
  accountActive: boolean;
  total: number;
  completed: number;
  inService: number;
  pending: number;
  rating: number | null;
  feedback: number;
};
export type DashboardReport = {
  generatedAt: string;
  range: DashboardRange;
  totals: {
    requests: number;
    pending: number;
    contacted: number;
    confirmed: number;
    inService: number;
    completed: number;
    cancelled: number;
  };
  trend: { bucket: string; total: number; completed: number }[];
  services: { id: string; name: string; total: number; completed: number }[];
  providers: DashboardProvider[];
  serviceCount: number;
  activeProviders: number;
};
const TTL_MS = 60_000;

export function dashboardRange(period: string, date?: string, now = new Date()): DashboardRange {
  if (!['day', 'month', 'year'].includes(period)) throw new BadRequestException('INVALID_PERIOD');
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const anchor = date ?? today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor)) throw new BadRequestException('INVALID_DATE');
  const [year, month, day] = anchor.split('-').map(Number);
  const checked = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 2024 ||
    checked.getUTCFullYear() !== year ||
    checked.getUTCMonth() !== month - 1 ||
    checked.getUTCDate() !== day ||
    checked.getTime() > now.getTime() + 366 * 86400000
  )
    throw new BadRequestException('INVALID_DATE');
  const dateStart =
    period === 'year' ? [year, 1, 1] : period === 'month' ? [year, month, 1] : [year, month, day];
  const start = new Date(Date.UTC(dateStart[0], dateStart[1] - 1, dateStart[2], -7));
  const end = new Date(
    period === 'day'
      ? Date.UTC(year, month - 1, day + 1, -7)
      : period === 'month'
        ? Date.UTC(year, month, 1, -7)
        : Date.UTC(year + 1, 0, 1, -7),
  );
  return {
    period: period as DashboardPeriod,
    from: start.toISOString(),
    to: end.toISOString(),
    label: period === 'year' ? String(year) : period === 'month' ? anchor.slice(0, 7) : anchor,
  };
}

const baseSql = [
  "WITH requests AS (SELECT m.value->>'providerId' AS provider_id,",
  "m.value->>'serviceId' AS service_id,",
  "COALESCE(m.value->>'serviceName','Dịch vụ khác') AS service_name,",
  "(m.value->>'createdAt')::timestamptz AS created_at,",
  '(' + inquiryStateSql + ') AS current_status',
  'FROM app_metadata m',
  "LEFT JOIN appointments a ON a.id::text=m.value->>'appointmentId'",
  "WHERE m.key LIKE 'mocmaria.inquiry.%'",
  "AND (m.value->>'createdAt')::timestamptz >= $1::timestamptz",
  "AND (m.value->>'createdAt')::timestamptz < $2::timestamptz",
  "AND m.value->>'archivedAt' IS NULL)",
].join(' ');

@Injectable()
export class AdminDashboardService {
  private cache = new Map<string, { until: number; value: DashboardReport }>();
  private running = new Map<string, Promise<DashboardReport>>();
  constructor(private readonly db: DataSource) {}

  private authorize(actor: AuthUserContext): void {
    if (
      !actor.roles.some((r) => r === 'ADMIN' || r === 'SUPER_ADMIN') ||
      !actor.permissions.includes('customers.manage') ||
      !actor.permissions.includes('staff.manage')
    )
      throw new ForbiddenException('Cần quyền quản lý lịch hẹn và KTV.');
  }

  async overview(
    actor: AuthUserContext,
    period = 'month',
    date?: string,
  ): Promise<DashboardReport> {
    this.authorize(actor);
    const range = dashboardRange(period, date);
    const key = range.period + ':' + range.label;
    const existing = this.cache.get(key);
    if (existing && existing.until > Date.now()) return existing.value;
    const ongoing = this.running.get(key);
    if (ongoing) return ongoing;
    const promise = this.compute(range)
      .then((value) => {
        this.cache.set(key, { until: Date.now() + TTL_MS, value });
        if (this.cache.size > 24) this.cache.delete(this.cache.keys().next().value!);
        return value;
      })
      .finally(() => this.running.delete(key));
    this.running.set(key, promise);
    return promise;
  }

  private async compute(range: DashboardRange): Promise<DashboardReport> {
    const args = [range.from, range.to];
    const group = range.period === 'year' ? 'month' : range.period === 'month' ? 'day' : 'hour';
    const label =
      range.period === 'year' ? 'YYYY-MM' : range.period === 'month' ? 'YYYY-MM-DD' : 'HH24:00';
    const [totals, trend, services, providers, catalog] = await Promise.all([
      this.db.query<Array<DashboardReport['totals']>>(
        baseSql +
          ' SELECT COUNT(*)::int requests,' +
          " COUNT(*) FILTER(WHERE current_status='PENDING')::int pending," +
          " COUNT(*) FILTER(WHERE current_status='CONTACTED')::int contacted," +
          " COUNT(*) FILTER(WHERE current_status='CONFIRMED')::int confirmed," +
          ' COUNT(*) FILTER(WHERE current_status=\'IN_SERVICE\')::int AS "inService",' +
          " COUNT(*) FILTER(WHERE current_status='COMPLETED')::int completed," +
          " COUNT(*) FILTER(WHERE current_status IN ('CANCELLED','DECLINED'))::int cancelled FROM requests",
        args,
      ),
      this.db.query<DashboardReport['trend']>(
        baseSql +
          " SELECT to_char(date_trunc('" +
          group +
          "', created_at AT TIME ZONE 'Asia/Ho_Chi_Minh'),'" +
          label +
          "') AS bucket, COUNT(*)::int total," +
          " COUNT(*) FILTER(WHERE current_status='COMPLETED')::int completed" +
          ' FROM requests GROUP BY bucket ORDER BY bucket',
        args,
      ),
      this.db.query<DashboardReport['services']>(
        baseSql +
          " SELECT COALESCE(service_id,'') id, service_name name," +
          " COUNT(*)::int total,COUNT(*) FILTER(WHERE current_status='COMPLETED')::int completed" +
          ' FROM requests GROUP BY service_id,service_name ORDER BY total DESC LIMIT 7',
        args,
      ),
      this.db.query<DashboardProvider[]>(
        baseSql +
          ', activity AS (SELECT provider_id,COUNT(*)::int total,' +
          " COUNT(*) FILTER(WHERE current_status='COMPLETED')::int completed," +
          ' COUNT(*) FILTER(WHERE current_status=\'IN_SERVICE\')::int AS "inService",' +
          " COUNT(*) FILTER(WHERE current_status IN ('PENDING','CONTACTED','CONFIRMED'))::int pending" +
          ' FROM requests GROUP BY provider_id),' +
          ' ratings AS (SELECT provider_application_id,' +
          " ROUND(AVG(stars) FILTER(WHERE visibility='PUBLISHED')::numeric,1)::float rating," +
          " COUNT(*) FILTER(WHERE visibility='PUBLISHED')::int feedback" +
          ' FROM provider_reviews GROUP BY provider_application_id)' +
          ' SELECT p.id,p.public_name name,p.status,u.is_active AS "accountActive",' +
          ' COALESCE(a.total,0)::int total,COALESCE(a.completed,0)::int completed,' +
          ' COALESCE(a."inService",0)::int AS "inService",COALESCE(a.pending,0)::int pending,' +
          ' r.rating,COALESCE(r.feedback,0)::int feedback' +
          ' FROM provider_applications p JOIN users u ON u.id=p.user_id' +
          ' LEFT JOIN activity a ON a.provider_id=p.id::text' +
          ' LEFT JOIN ratings r ON r.provider_application_id=p.id' +
          " WHERE p.status NOT IN ('REJECTED','SUSPENDED')" +
          ' ORDER BY COALESCE(a.total,0) DESC,p.public_name LIMIT 60',
        args,
      ),
      this.db.query<Array<{ total: number }>>(
        'SELECT COUNT(*)::int total FROM services WHERE is_published=true',
        [],
      ),
    ]);
    return {
      generatedAt: new Date().toISOString(),
      range,
      totals: totals[0] ?? {
        requests: 0,
        pending: 0,
        contacted: 0,
        confirmed: 0,
        inService: 0,
        completed: 0,
        cancelled: 0,
      },
      trend,
      services,
      providers,
      serviceCount: Number(catalog[0]?.total ?? 0),
      activeProviders: providers.filter((p) => p.status === 'APPROVED' && p.accountActive).length,
    };
  }

  async providerDetail(
    actor: AuthUserContext,
    id: string,
    period = 'month',
    date?: string,
  ): Promise<{
    provider: DashboardProvider;
    feedback: Array<{ id: string; stars: number; comment: string; createdAt: string }>;
    range: DashboardRange;
  }> {
    this.authorize(actor);
    if (!/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(id))
      throw new BadRequestException('INVALID_PROVIDER_ID');
    const report = await this.overview(actor, period, date);
    const provider = report.providers.find((row) => row.id === id);
    if (!provider) throw new NotFoundException('PROVIDER_NOT_IN_REPORT');
    const feedback = await this.db.query<
      Array<{
        id: string;
        stars: number;
        comment: string;
        createdAt: string;
      }>
    >(
      'SELECT id,stars,LEFT(comment,250) comment,created_at AS "createdAt"' +
        " FROM provider_reviews WHERE provider_application_id=$1::uuid AND visibility='PUBLISHED'" +
        ' ORDER BY created_at DESC LIMIT 8',
      [id],
    );
    return { provider, feedback, range: report.range };
  }
}
