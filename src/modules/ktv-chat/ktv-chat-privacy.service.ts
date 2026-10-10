import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import type { AuthUserContext } from '../identity/identity.types';

interface PrivacyRecord {
  passwordHash?: string;
  failures: number;
  blockedUntil?: number;
  grants: Record<string, { expiresAt: number; tokenHash: string }>;
}
export const privacyKey = (id: string): string => `mocmaria.chat.privacy.${id}`;
const UNLOCK_MS = 15 * 60 * 1000;

@Injectable()
export class KtvChatPrivacyService {
  constructor(private readonly db: DataSource) {}

  private async record(manager: EntityManager, id: string): Promise<PrivacyRecord> {
    const [row] = await manager.query<{ value: PrivacyRecord }[]>(
      'SELECT value FROM app_metadata WHERE key=$1',
      [privacyKey(id)],
    );
    return row?.value ?? { failures: 0, grants: {} };
  }
  private async save(manager: EntityManager, id: string, value: PrivacyRecord): Promise<void> {
    // Persist only active grants, bounded per thread. Access remains tied to a live auth session.
    value.grants = Object.fromEntries(
      Object.entries(value.grants)
        .filter(([, grant]) => grant.expiresAt > Date.now())
        .sort((a, b) => b[1].expiresAt - a[1].expiresAt)
        .slice(0, 50),
    );
    await manager.query(
      `INSERT INTO app_metadata(key,value) VALUES($1,$2::jsonb)
      ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=clock_timestamp()`,
      [privacyKey(id), JSON.stringify(value)],
    );
  }
  private async owner(manager: EntityManager, actor: AuthUserContext, id: string): Promise<void> {
    const [thread] = await manager.query<{ customer_user_id: string }[]>(
      `SELECT customer_user_id FROM ktv_chat_threads WHERE id=$1
       AND (customer_user_id=$2 OR provider_user_id=$2) FOR UPDATE`,
      [id, actor.id],
    );
    if (!thread) throw new NotFoundException('Không tìm thấy hội thoại.');
    if (thread.customer_user_id !== actor.id || !actor.permissions.includes('customer.portal'))
      throw new ForbiddenException('Chỉ khách hàng của hội thoại được quản lý mật khẩu riêng.');
  }
  async assertAccess(
    manager: EntityManager,
    actor: AuthUserContext,
    id: string,
    customerId: string,
    token?: string,
  ): Promise<void> {
    if (actor.id !== customerId) return;
    const record = await this.record(manager, id);
    const grant = record.grants[actor.sessionId];
    const supplied =
      typeof token === 'string' && token.length <= 128
        ? createHash('sha256').update(token).digest()
        : null;
    const expected = grant?.tokenHash ? Buffer.from(grant.tokenHash, 'hex') : null;
    if (
      record.passwordHash &&
      !(
        grant?.expiresAt > Date.now() &&
        supplied &&
        expected?.length === supplied.length &&
        timingSafeEqual(expected, supplied)
      )
    )
      throw new HttpException(
        { error: 'CHAT_LOCKED', message: 'Hội thoại đã khóa. Nhập mật khẩu chat để tiếp tục.' },
        403,
      );
  }
  private async proof(
    manager: EntityManager,
    actor: AuthUserContext,
    record: PrivacyRecord,
    password: string,
    account = false,
  ): Promise<403 | 429 | null> {
    if ((record.blockedUntil ?? 0) > Date.now()) return 429;
    let hash = record.passwordHash;
    if (account) {
      const [user] = await manager.query<{ password_hash: string }[]>(
        'SELECT password_hash FROM users WHERE id=$1 AND is_active',
        [actor.id],
      );
      hash = user?.password_hash;
    }
    if (!hash || !(await argon2.verify(hash, password))) {
      record.failures = (record.failures ?? 0) + 1;
      if (record.failures >= 5) {
        record.failures = 0;
        record.blockedUntil = Date.now() + 5 * 60 * 1000;
        return 429;
      }
      return 403;
    }
    record.failures = 0;
    delete record.blockedUntil;
    return null;
  }
  async update(
    actor: AuthUserContext,
    id: string,
    action: 'set' | 'unlock' | 'lock' | 'remove' | 'recover',
    password = '',
    currentPassword = '',
  ): Promise<string | undefined> {
    let unlockToken: string | undefined;
    const failure = await this.db.transaction(async (manager) => {
      await this.owner(manager, actor, id);
      const record = await this.record(manager, id);
      if (action === 'lock') {
        delete record.grants[actor.sessionId];
        if (record.passwordHash) await this.save(manager, id, record);
        return null;
      }
      if (action !== 'set' && !record.passwordHash)
        throw new BadRequestException('Hội thoại chưa đặt mật khẩu.');
      const needsProof = !!record.passwordHash;
      if (needsProof) {
        const error = await this.proof(
          manager,
          actor,
          record,
          action === 'set' ? currentPassword : password,
          action === 'recover',
        );
        if (error) {
          await this.save(manager, id, record);
          return error;
        }
      }
      if (action === 'set') {
        record.passwordHash = await argon2.hash(password, {
          type: argon2.argon2id,
          memoryCost: 19456,
          timeCost: 2,
          parallelism: 1,
        });
        record.grants = {};
      } else if (action === 'unlock') {
        // A new proof replaces this session's old proof; other sessions stay independent.
      } else {
        // Removing a password never deletes chat history.
        await manager.query('DELETE FROM app_metadata WHERE key=$1', [privacyKey(id)]);
      }
      if (action === 'set' || action === 'unlock') {
        unlockToken = randomBytes(32).toString('base64url');
        record.grants[actor.sessionId] = {
          expiresAt: Date.now() + UNLOCK_MS,
          tokenHash: createHash('sha256').update(unlockToken).digest('hex'),
        };
        await this.save(manager, id, record);
      }
      await manager.query(
        `INSERT INTO audit_logs(event,actor_user_id,metadata) VALUES($1,$2,$3::jsonb)`,
        [`KTV_CHAT_PRIVACY_${action.toUpperCase()}`, actor.id, JSON.stringify({ threadId: id })],
      );
      return null;
    });
    // Throw after commit so failed-attempt counters cannot be rolled back by a bad password.
    if (failure)
      throw new HttpException(
        {
          error: failure === 429 ? 'CHAT_PASSWORD_RATE_LIMIT' : 'CHAT_PASSWORD_INVALID',
          message:
            failure === 429
              ? 'Bạn nhập sai quá nhiều lần. Vui lòng thử lại sau 5 phút.'
              : 'Mật khẩu chưa đúng.',
        },
        failure,
      );
    return unlockToken;
  }
}
