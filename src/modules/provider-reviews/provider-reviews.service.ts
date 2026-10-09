import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { ProvidersService } from '../providers/providers.service';
import type { AuthUserContext } from '../identity/identity.types';
import type {
  CreateProviderReviewDto,
  EditProviderReviewDto,
  ModerateProviderReviewDto,
} from './provider-reviews.dto';

interface Review {
  id: string;
  appointment_id: string;
  provider_application_id: string;
  customer_user_id: string;
  stars: number;
  comment: string;
  visibility: 'PUBLISHED' | 'HIDDEN';
  version: number;
  created_at: Date;
  updated_at: Date;
}
export interface PublicReview {
  id: string;
  stars: number;
  comment: string;
  author_label: string;
  service_name: string;
  created_at: Date;
  updated_at: Date;
}
export interface RatingSummary {
  average: number | null;
  count: number;
  distribution: Record<string, number>;
}
export interface EligibleReview {
  appointment_id: string;
  provider_application_id: string;
  provider_name: string;
  service_name: string;
  completed_at: Date;
  review_id: string | null;
  stars: number | null;
  comment: string | null;
  visibility: string | null;
  version: number | null;
  editable_until: Date | null;
}
@Injectable()
export class ProviderReviewsService {
  constructor(
    private readonly db: DataSource,
    private readonly providers: ProvidersService,
  ) {}
  private customer(actor: AuthUserContext): void {
    if (!actor.permissions.includes('customer.portal'))
      throw new ForbiddenException('Chỉ khách hàng đã sử dụng dịch vụ được đánh giá.');
  }
  async eligible(actor: AuthUserContext, providerId?: string): Promise<EligibleReview[]> {
    this.customer(actor);
    return this.db.query(
      `SELECT a.id AS appointment_id,s.provider_application_id,p.public_name AS provider_name,
      COALESCE(i.service_name,'Dịch vụ chăm sóc') AS service_name,a.ends_at AS completed_at,
      r.id AS review_id,r.stars,r.comment,r.visibility,r.version,r.created_at+interval '7 days' AS editable_until
      FROM appointments a JOIN appointment_staff s ON s.appointment_id=a.id
      JOIN provider_applications p ON p.id=s.provider_application_id
      LEFT JOIN appointment_items i ON i.appointment_id=a.id
      LEFT JOIN provider_reviews r ON r.appointment_id=a.id AND r.provider_application_id=s.provider_application_id
      WHERE a.customer_user_id=$1 AND a.status='COMPLETED' AND a.ends_at<=clock_timestamp()
      AND p.user_id<>$1
      AND ($2::uuid IS NULL OR s.provider_application_id=$2) ORDER BY a.ends_at DESC,a.id,s.provider_application_id`,
      [actor.id, providerId ?? null],
    );
  }
  private async history(
    manager: EntityManager,
    actorId: string,
    review: Review,
    action: string,
    reason?: string,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO provider_review_history(review_id,actor_user_id,action,stars,comment,visibility,version,reason)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        review.id,
        actorId,
        action,
        review.stars,
        review.comment,
        review.visibility,
        review.version,
        reason ?? null,
      ],
    );
  }
  async create(actor: AuthUserContext, dto: CreateProviderReviewDto): Promise<Review> {
    this.customer(actor);
    return this.db.transaction(async (manager) => {
      const [appointment] = await manager.query<{ id: string }[]>(
        `SELECT a.id FROM appointments a
        JOIN appointment_staff s ON s.appointment_id=a.id
        JOIN provider_applications p ON p.id=s.provider_application_id WHERE a.id=$1 AND a.customer_user_id=$2 AND p.user_id<>$2
        AND s.provider_application_id=$3 AND a.status='COMPLETED' AND a.ends_at<=clock_timestamp() FOR SHARE OF a`,
        [dto.appointmentId, actor.id, dto.providerApplicationId],
      );
      if (!appointment)
        throw new ForbiddenException('Bạn chỉ có thể đánh giá KTV của lịch hẹn đã hoàn thành.');
      const [created] = await manager.query<Review[]>(
        `INSERT INTO provider_reviews(appointment_id,provider_application_id,customer_user_id,stars,comment)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(appointment_id,provider_application_id) DO NOTHING RETURNING *`,
        [dto.appointmentId, dto.providerApplicationId, actor.id, dto.stars, dto.comment],
      );
      if (created) {
        await this.history(manager, actor.id, created, 'CREATE');
        return created;
      }
      const [existing] = await manager.query<Review[]>(
        `SELECT * FROM provider_reviews WHERE appointment_id=$1 AND provider_application_id=$2`,
        [dto.appointmentId, dto.providerApplicationId],
      );
      if (existing.stars !== dto.stars || existing.comment !== dto.comment)
        throw new ConflictException(
          'Bạn đã đánh giá lịch hẹn này. Hãy dùng chức năng sửa đánh giá.',
        );
      return existing;
    });
  }
  async edit(actor: AuthUserContext, id: string, dto: EditProviderReviewDto): Promise<Review> {
    this.customer(actor);
    return this.db.transaction(async (manager) => {
      const [review] = await manager.query<Review[]>(
        `SELECT * FROM provider_reviews WHERE id=$1 AND customer_user_id=$2 FOR UPDATE`,
        [id, actor.id],
      );
      if (!review) throw new NotFoundException('Không tìm thấy đánh giá của bạn.');
      if (review.visibility !== 'PUBLISHED')
        throw new ForbiddenException('Đánh giá đang được kiểm duyệt nên chưa thể sửa.');
      if (review.version !== dto.expectedVersion)
        throw new ConflictException('Đánh giá đã thay đổi. Vui lòng tải lại.');
      const [window] = await manager.query<{ allowed: boolean }[]>(
        `SELECT created_at+interval '7 days'>clock_timestamp() AS allowed FROM provider_reviews WHERE id=$1`,
        [id],
      );
      if (!window.allowed)
        throw new ForbiddenException('Thời hạn sửa đánh giá là 7 ngày kể từ lần gửi đầu tiên.');
      await manager.query(
        `UPDATE provider_reviews SET stars=$2,comment=$3,version=version+1,updated_at=clock_timestamp() WHERE id=$1`,
        [id, dto.stars, dto.comment],
      );
      const [saved] = await manager.query<Review[]>('SELECT * FROM provider_reviews WHERE id=$1', [
        id,
      ]);
      await this.history(manager, actor.id, saved, 'EDIT');
      return saved;
    });
  }
  async ratingSummaries(): Promise<Record<string, { average: number | null; count: number }>> {
    const providers = await this.providers.publicProviders();
    if (!providers.length) return {};
    const rows = await this.db.query<
      { provider_application_id: string; average: string; count: number }[]
    >(
      `SELECT r.provider_application_id,round(avg(r.stars),1) AS average,count(*)::int AS count
      FROM provider_reviews r JOIN appointments a ON a.id=r.appointment_id WHERE r.visibility='PUBLISHED'
      AND a.status='COMPLETED' AND r.provider_application_id=ANY($1::uuid[]) GROUP BY r.provider_application_id`,
      [providers.map((p) => p.id)],
    );
    return Object.fromEntries(
      providers.map((p) => {
        const row = rows.find((r) => r.provider_application_id === p.id);
        return [p.id, { average: row ? Number(row.average) : null, count: row?.count ?? 0 }];
      }),
    );
  }
  async publicReviews(
    providerId: string,
    page = 1,
  ): Promise<{ summary: RatingSummary; items: PublicReview[]; page: number; hasMore: boolean }> {
    await this.providers.publicProvider(providerId);
    const rows = await this.db.query<{ stars: number; count: number }[]>(
      `SELECT r.stars,count(*)::int AS count FROM provider_reviews r
      JOIN appointments a ON a.id=r.appointment_id WHERE r.provider_application_id=$1 AND r.visibility='PUBLISHED'
      AND a.status='COMPLETED' GROUP BY r.stars`,
      [providerId],
    );
    const count = rows.reduce((n, r) => n + r.count, 0);
    const distribution: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
    for (const row of rows) distribution[row.stars] = row.count;
    const summary: RatingSummary = {
      count,
      average: count
        ? Math.round((rows.reduce((n, r) => n + r.count * r.stars, 0) / count) * 10) / 10
        : null,
      distribution,
    };
    // No customer identity, appointment UUID, address or chat text is exposed publicly.
    const items = await this.db.query<PublicReview[]>(
      `SELECT r.id,r.stars,r.comment,'Khách đã sử dụng dịch vụ' AS author_label,
      COALESCE(i.service_name,'Dịch vụ chăm sóc') AS service_name,r.created_at,r.updated_at
      FROM provider_reviews r JOIN appointments a ON a.id=r.appointment_id
      LEFT JOIN appointment_items i ON i.appointment_id=r.appointment_id
      WHERE r.provider_application_id=$1 AND r.visibility='PUBLISHED' AND a.status='COMPLETED'
      ORDER BY r.created_at DESC,r.id DESC LIMIT 10 OFFSET $2`,
      [providerId, (page - 1) * 10],
    );
    return { summary, items, page, hasMore: page * 10 < count };
  }
  async moderate(
    actor: AuthUserContext,
    id: string,
    dto: ModerateProviderReviewDto,
  ): Promise<Review> {
    return this.db.transaction(async (manager) => {
      const [review] = await manager.query<(Review & { provider_user_id: string })[]>(
        `SELECT r.*,p.user_id AS provider_user_id
        FROM provider_reviews r JOIN provider_applications p ON p.id=r.provider_application_id WHERE r.id=$1 FOR UPDATE OF r`,
        [id],
      );
      if (!review) throw new NotFoundException('Không tìm thấy đánh giá.');
      if (review.customer_user_id === actor.id || review.provider_user_id === actor.id)
        throw new ForbiddenException('Không được tự kiểm duyệt đánh giá của mình.');
      if (review.version !== dto.expectedVersion)
        throw new ConflictException('Đánh giá đã thay đổi. Vui lòng tải lại.');
      await manager.query(
        `UPDATE provider_reviews SET visibility=$2,version=version+1,updated_at=clock_timestamp() WHERE id=$1`,
        [id, dto.visibility],
      );
      const [saved] = await manager.query<Review[]>('SELECT * FROM provider_reviews WHERE id=$1', [
        id,
      ]);
      await this.history(manager, actor.id, saved, 'MODERATE', dto.reason);
      return saved;
    });
  }
}
