import type { DataSource, EntityManager } from 'typeorm';
import { ProviderReviewsService } from './provider-reviews.service';
import type { ProviderDisplayService } from '../provider-display/provider-display.service';
import type { AuthUserContext } from '../identity/identity.types';

const customer = {
  id: 'customer-1',
  permissions: ['customer.portal'],
} as AuthUserContext;
const privateReview = {
  id: 'review-1',
  appointment_id: 'appt-1',
  provider_application_id: 'ktv-1',
  customer_user_id: 'customer-1',
  stars: 5,
  comment: 'Chăm sóc tận tâm',
  visibility: 'HIDDEN',
  version: 1,
};

describe('Provider reviews require moderation', () => {
  it('shows empty reviews and unrated badge for publicly visible KTV with APPLIED enrollment', async () => {
    const display = {
      publicDisplay: jest
        .fn()
        .mockResolvedValue({ rows: [{ providerId: 'ktv-1', visible: true }] }),
    } as unknown as ProviderDisplayService;
    const query = jest.fn().mockResolvedValue([]);
    const service = new ProviderReviewsService({ query } as unknown as DataSource, display);
    const result = await service.publicReviews('ktv-1');
    expect(result).toEqual({
      summary: {
        count: 0,
        average: null,
        distribution: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 },
      },
      items: [],
      page: 1,
      hasMore: false,
    });
    expect(await service.ratingSummaries()).toEqual({ 'ktv-1': { average: null, count: 0 } });
    expect(query.mock.calls.some(([sql]: [string]) => sql.includes('provider_reviews'))).toBe(true);
  });

  it('keeps hidden KTV reviews private even when a direct profile URL is known', async () => {
    const display = {
      publicDisplay: jest
        .fn()
        .mockResolvedValue({ rows: [{ providerId: 'ktv-1', visible: false }] }),
    } as unknown as ProviderDisplayService;
    const query = jest.fn();
    const service = new ProviderReviewsService({ query } as unknown as DataSource, display);
    await expect(service.publicReviews('ktv-1')).rejects.toHaveProperty('status', 404);
    expect(await service.ratingSummaries()).toEqual({});
    expect(query).not.toHaveBeenCalled();
  });
  it('always stores newly submitted comments hidden, even before running migration', async () => {
    const query = jest.fn((sql: string) => {
      if (sql.includes('SELECT a.id')) return Promise.resolve([{ id: 'appt-1' }]);
      if (sql.includes('INSERT INTO provider_reviews(')) return Promise.resolve([privateReview]);
      return Promise.resolve([]);
    });
    const db = {
      transaction: (run: (manager: EntityManager) => unknown) =>
        run({ query } as unknown as EntityManager),
    } as unknown as DataSource;
    const service = new ProviderReviewsService(db, {} as ProviderDisplayService);
    const saved = await service.create(customer, {
      appointmentId: 'appt-1',
      providerApplicationId: 'ktv-1',
      stars: 5,
      comment: privateReview.comment,
    });
    expect(saved.visibility).toBe('HIDDEN');
    const statement = query.mock.calls.find((call) =>
      call[0].includes('INSERT INTO provider_reviews('),
    )?.[0];
    expect(statement).toContain("'HIDDEN'");
    expect(
      query.mock.calls.some((call) => call[0].includes('INSERT INTO provider_review_history')),
    ).toBe(true);
  });

  it('sends edited approved reviews back to moderation and keeps optimistic locking', async () => {
    const query = jest.fn((sql: string) => {
      if (sql.includes('customer_user_id=$2 FOR UPDATE'))
        return Promise.resolve([{ ...privateReview, visibility: 'PUBLISHED' }]);
      if (sql.includes('interval') && sql.includes('allowed'))
        return Promise.resolve([{ allowed: true }]);
      if (sql.includes('SELECT * FROM provider_reviews WHERE id=$1'))
        return Promise.resolve([{ ...privateReview, visibility: 'HIDDEN', version: 2 }]);
      return Promise.resolve([]);
    });
    const db = {
      transaction: (run: (manager: EntityManager) => unknown) =>
        run({ query } as unknown as EntityManager),
    } as unknown as DataSource;
    const service = new ProviderReviewsService(db, {} as ProviderDisplayService);
    const saved = await service.edit(customer, 'review-1', {
      stars: 4,
      comment: 'Có thể cải thiện thời gian',
      expectedVersion: 1,
    });
    expect(saved.visibility).toBe('HIDDEN');
    const update = query.mock.calls.find((call) =>
      call[0].includes('UPDATE provider_reviews SET stars='),
    )?.[0];
    expect(update).toContain("visibility='HIDDEN'");
  });

  it('returns pending moderation records with version and no customer identifiers', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ pending: 1 }])
      .mockResolvedValueOnce([{ count: 1 }])
      .mockResolvedValueOnce([
        {
          id: privateReview.id,
          provider_application_id: privateReview.provider_application_id,
          provider_name: 'KTV An',
          service_name: 'Chăm sóc',
          stars: 5,
          comment: 'Tốt',
          moderation_status: 'PENDING',
          visibility: 'HIDDEN',
          version: 1,
        },
      ]);
    const service = new ProviderReviewsService(
      { query } as unknown as DataSource,
      {} as ProviderDisplayService,
    );
    const result = await service.adminReviews({ page: 1, status: 'PENDING' });
    expect(result).toMatchObject({ pending: 1, total: 1, hasMore: false });
    expect(result.items[0].moderation_status).toBe('PENDING');
    expect(JSON.stringify(result)).not.toContain('customer-1');
  });
});
