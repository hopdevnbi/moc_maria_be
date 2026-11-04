import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import sharp from 'sharp';
import { DataSource, type EntityManager } from 'typeorm';
import { AuditLog } from '../identity/entities/audit-log.entity';
import type { AuthUserContext } from '../identity/identity.types';
import { ProviderDisplayService } from '../provider-display/provider-display.service';
import {
  TIP_MAX_VND,
  TIP_MIN_VND,
  type CreateTipIntentDto,
  type UpdateTipSettingsDto,
} from './provider-tips.dto';

export interface TipSettings {
  version: number;
  bankName: string;
  bankAccount: string;
  accountHolder: string;
  qrUrl: string | null;
  updatedAt: string | null;
}

type TipStatus = 'INTENT' | 'SELF_REPORTED';

interface TipRecord {
  id: string;
  providerId: string;
  amountVnd: number;
  status: TipStatus;
  tokenHash: string;
  createdAt: string;
  selfReportedAt: string | null;
  keepsakePath: string | null;
  keepsakeAt: string | null;
}

interface FileUpload {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

const settingKey = (id: string): string => `mocmaria.ktv.tip.settings.v1.${id}`;
const intentKey = (id: string): string => `mocmaria.ktv.tip.intent.v1.${id}`;
const emptySettings = (): TipSettings => ({
  version: 0,
  bankName: '',
  bankAccount: '',
  accountHolder: '',
  qrUrl: null,
  updatedAt: null,
});

@Injectable()
export class ProviderTipsService {
  constructor(
    private readonly db: DataSource,
    private readonly display: ProviderDisplayService,
  ) {}

  private async visible(id: string): Promise<void> {
    const snapshot = await this.display.publicDisplay();
    if (!snapshot.rows.some((item) => item.providerId === id && item.visible)) {
      throw new NotFoundException('Hồ sơ kỹ thuật viên hiện không công khai.');
    }
  }

  private async ownerOrAdmin(actor: AuthUserContext, id: string): Promise<string> {
    const [owner] = await this.db.query<{ userId: string }[]>(
      `SELECT p.user_id AS "userId" FROM provider_applications p
       INNER JOIN users u ON u.id=p.user_id WHERE p.id=$1 AND u.is_active`,
      [id],
    );
    if (!owner) throw new NotFoundException('Không tìm thấy hồ sơ kỹ thuật viên.');
    if (actor.roles.includes('SUPER_ADMIN')) return owner.userId;
    if (
      actor.id !== owner.userId ||
      !actor.roles.some((role) => role === 'THERAPIST' || role === 'DOCTOR_CONSULTANT')
    ) {
      throw new ForbiddenException('Bạn chỉ có thể chỉnh thông tin nhận tip của chính mình.');
    }
    return owner.userId;
  }

  private async loadSettings(m: EntityManager, id: string): Promise<TipSettings> {
    const [row] = await m.query<{ value: TipSettings }[]>(
      'SELECT value FROM app_metadata WHERE key=$1',
      [settingKey(id)],
    );
    return row?.value ?? emptySettings();
  }

  async publicSettings(id: string): Promise<TipSettings> {
    await this.visible(id);
    return this.loadSettings(this.db.manager, id);
  }

  async editorSettings(actor: AuthUserContext, id: string): Promise<TipSettings> {
    await this.ownerOrAdmin(actor, id);
    return this.loadSettings(this.db.manager, id);
  }

  private storage(): { endpoint: string; cdn: string; key: string } {
    const zone = process.env['BUNNY_STORAGE_ZONE']?.trim();
    const key = (
      process.env['BUNNY_STORAGE_ACCESS_KEY'] || process.env['BUNNY_STORAGE_API_KEY']
    )?.trim();
    const cdn = (process.env['BUNNY_CDN_BASE_URL'] || process.env['BUNNY_STORAGE_CDN_URL'])?.trim();
    const region = process.env['BUNNY_STORAGE_REGION']?.trim() || 'sg';
    if (
      !zone ||
      !key ||
      !cdn ||
      !/^[a-z0-9_-]+$/i.test(zone) ||
      !/^[a-z0-9-]+$/i.test(region) ||
      !/^https:\/\/[a-z0-9.-]+\/?$/i.test(cdn)
    ) {
      throw new ServiceUnavailableException('Chưa cấu hình kho ảnh của Mộc Maria.');
    }
    return {
      endpoint: `https://${region}.storage.bunnycdn.com/${zone}`,
      cdn: cdn.replace(/\/$/, ''),
      key,
    };
  }

  private validQr(id: string, qrUrl: string | null): string | null {
    if (!qrUrl) return null;
    const { cdn } = this.storage();
    const prefix = `${cdn}/moc-maria/provider-tips/qr/${id}/`;
    if (
      !qrUrl.startsWith(prefix) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.png$/i.test(
        qrUrl.slice(prefix.length),
      )
    ) {
      throw new BadRequestException('Chỉ dùng mã QR đã tải lên đúng hồ sơ KTV.');
    }
    return qrUrl;
  }

  async saveSettings(
    actor: AuthUserContext,
    id: string,
    dto: UpdateTipSettingsDto,
  ): Promise<TipSettings> {
    const ownerId = await this.ownerOrAdmin(actor, id);
    const bankName = dto.bankName.trim();
    const accountHolder = dto.accountHolder.trim();
    const bankAccount = dto.bankAccount.trim().replace(/\s+/g, '');
    if (bankAccount && !/^\d{5,25}$/.test(bankAccount)) {
      throw new BadRequestException('Số tài khoản cần có từ 5 đến 25 chữ số.');
    }
    if (bankAccount && (!bankName || !accountHolder)) {
      throw new BadRequestException('Vui lòng ghi tên ngân hàng và chủ tài khoản.');
    }
    const qrUrl = this.validQr(id, dto.qrUrl || null);
    return this.db.transaction(async (m) => {
      await m.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [settingKey(id)]);
      const current = await this.loadSettings(m, id);
      if (current.version !== dto.expectedVersion) {
        throw new ConflictException('Thông tin đã được thay đổi ở thiết bị khác. Hãy tải lại.');
      }
      const saved: TipSettings = {
        version: current.version + 1,
        bankName,
        accountHolder,
        bankAccount,
        qrUrl,
        updatedAt: new Date().toISOString(),
      };
      await m.query(
        `INSERT INTO app_metadata(key,value) VALUES($1,$2::jsonb)
         ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=clock_timestamp()`,
        [settingKey(id), JSON.stringify(saved)],
      );
      await m.save(AuditLog, {
        event: 'provider.tip.settings.updated',
        actorUserId: actor.id,
        targetUserId: ownerId,
        // Never log the public account number or the access key in audit records.
        metadata: {
          providerId: id,
          version: saved.version,
          hasAccount: !!bankAccount,
          hasQr: !!qrUrl,
        },
      });
      return saved;
    });
  }

  private async normalizeImage(file: FileUpload | undefined, maxBytes: number): Promise<Buffer> {
    if (!file?.buffer || !file.size) throw new BadRequestException('Vui lòng chọn ảnh.');
    if (
      !['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype) ||
      file.size > maxBytes
    ) {
      throw new BadRequestException('Chỉ nhận ảnh JPG/PNG/WebP, tối đa 5 MB.');
    }
    try {
      const img = sharp(file.buffer, { limitInputPixels: 24_000_000 });
      const meta = await img.metadata();
      if (
        !meta.width ||
        !meta.height ||
        meta.width < 180 ||
        meta.height < 180 ||
        !['jpeg', 'png', 'webp'].includes(meta.format || '')
      ) {
        throw new Error('invalid');
      }
      // Strip EXIF & sensitive phone location metadata. PNG preserves sharp QR edges.
      return img
        .rotate()
        .resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true })
        .png({ compressionLevel: 9, palette: false })
        .toBuffer();
    } catch {
      throw new BadRequestException('Ảnh bị lỗi hoặc có kích thước quá nhỏ.');
    }
  }

  private async bunnyPut(path: string, body: Buffer, mime: string): Promise<string> {
    const config = this.storage();
    try {
      const reply = await fetch(`${config.endpoint}/${path}`, {
        method: 'PUT',
        headers: { AccessKey: config.key, 'Content-Type': mime },
        body: new Uint8Array(body),
        signal: AbortSignal.timeout(30000),
      });
      if (!reply.ok) throw new Error('bad upload response');
      return `${config.cdn}/${path}`;
    } catch {
      throw new BadGatewayException('Không tải được ảnh lên CDN. Vui lòng thử lại.');
    }
  }

  async uploadQr(
    actor: AuthUserContext,
    id: string,
    file: FileUpload | undefined,
  ): Promise<{ qrUrl: string }> {
    const ownerId = await this.ownerOrAdmin(actor, id);
    const image = await this.normalizeImage(file, 5 * 1024 * 1024);
    const path = `moc-maria/provider-tips/qr/${id}/${randomUUID()}.png`;
    const qrUrl = await this.bunnyPut(path, image, 'image/png');
    await this.db.manager.save(AuditLog, {
      event: 'provider.tip.qr.uploaded',
      actorUserId: actor.id,
      targetUserId: ownerId,
      metadata: { providerId: id, bytes: image.length },
    });
    return { qrUrl };
  }

  private tokenDigest(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async readIntent(id: string, tipId: string, token?: string): Promise<TipRecord> {
    const [row] = await this.db.query<{ value: TipRecord }[]>(
      'SELECT value FROM app_metadata WHERE key=$1',
      [intentKey(tipId)],
    );
    const record = row?.value;
    if (!record || record.providerId !== id)
      throw new NotFoundException('Không tìm thấy lời cảm ơn.');
    if (token && this.tokenDigest(token) !== record.tokenHash) {
      throw new ForbiddenException('Mã xác nhận lời cảm ơn không hợp lệ.');
    }
    return record;
  }

  async createIntent(
    id: string,
    dto: CreateTipIntentDto,
  ): Promise<{
    id: string;
    token: string;
    amountVnd: number;
    status: TipStatus;
  }> {
    await this.visible(id);
    const settings = await this.loadSettings(this.db.manager, id);
    if (!settings.bankAccount && !settings.qrUrl) {
      throw new ConflictException('KTV chưa công bố tài khoản. Hãy nhắn tin để nhận thông tin.');
    }
    if (
      !Number.isInteger(dto.amountVnd) ||
      dto.amountVnd < TIP_MIN_VND ||
      dto.amountVnd > TIP_MAX_VND
    ) {
      throw new BadRequestException('Số tiền tip phải từ 10.000đ đến 10.000.000đ.');
    }
    const token = randomUUID();
    const record: TipRecord = {
      id: dto.clientRequestId,
      providerId: id,
      amountVnd: dto.amountVnd,
      status: 'INTENT',
      tokenHash: this.tokenDigest(token),
      createdAt: new Date().toISOString(),
      selfReportedAt: null,
      keepsakePath: null,
      keepsakeAt: null,
    };
    const inserted = await this.db.query<{ key: string }[]>(
      'INSERT INTO app_metadata(key,value) VALUES ($1,$2::jsonb) ON CONFLICT(key) DO NOTHING RETURNING key',
      [intentKey(record.id), JSON.stringify(record)],
    );
    if (!inserted.length) {
      throw new ConflictException('Lượt tip đã được tạo. Vui lòng quay lại và thử lần khác.');
    }
    return { id: record.id, token, amountVnd: record.amountVnd, status: record.status };
  }

  async selfReport(
    id: string,
    tipId: string,
    token: string,
  ): Promise<{
    status: TipStatus;
    selfReportedAt: string | null;
  }> {
    const record = await this.readIntent(id, tipId, token);
    if (record.status === 'SELF_REPORTED') {
      return { status: record.status, selfReportedAt: record.selfReportedAt };
    }
    const updated = await this.db.query<{ value: TipRecord }[]>(
      `UPDATE app_metadata SET
        value=jsonb_set(jsonb_set(value,'{status}',to_jsonb('SELF_REPORTED'::text)),'{selfReportedAt}',to_jsonb($3::text)),
        updated_at=clock_timestamp()
       WHERE key=$1 AND value->>'tokenHash'=$2 AND value->>'status'='INTENT'
       RETURNING value`,
      [intentKey(tipId), this.tokenDigest(token), new Date().toISOString()],
    );
    if (!updated.length) throw new ConflictException('Trạng thái đã được cập nhật. Hãy thử lại.');
    return { status: 'SELF_REPORTED', selfReportedAt: updated[0].value.selfReportedAt };
  }

  private encryptionKey(): Buffer {
    // Isolated cipher context; ciphertext is safe on a public CDN path.
    // Changing JWT_ACCESS_SECRET requires a deliberate keepsake-key migration.
    const secret =
      process.env['TIP_KEEPSAKE_SECRET']?.trim() || process.env['JWT_ACCESS_SECRET']?.trim();
    if (!secret || secret.length < 32) {
      throw new ServiceUnavailableException('Chưa cấu hình mã hóa ảnh kỷ niệm.');
    }
    return createHmac('sha256', secret).update('mocmaria.private.tip.keepsake.v1').digest();
  }

  private encryptKeepsake(image: Buffer): Buffer {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(image), cipher.final()]);
    return Buffer.concat([Buffer.from('MMTIP1'), iv, cipher.getAuthTag(), ciphertext]);
  }

  private decryptKeepsake(ciphertext: Buffer): Buffer {
    if (ciphertext.subarray(0, 6).toString('ascii') !== 'MMTIP1' || ciphertext.length < 35) {
      throw new BadGatewayException('Ảnh kỷ niệm bị lỗi định dạng.');
    }
    try {
      const iv = ciphertext.subarray(6, 18);
      const tag = ciphertext.subarray(18, 34);
      const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey(), iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext.subarray(34)), decipher.final()]);
    } catch {
      throw new BadGatewayException('Không thể đọc ảnh kỷ niệm đã mã hóa.');
    }
  }

  async uploadKeepsake(
    id: string,
    tipId: string,
    token: string,
    consent: string | undefined,
    file: FileUpload | undefined,
  ): Promise<{ saved: true }> {
    if (consent !== 'PRIVATE_TIP_KEEPSAKE_V1') {
      throw new BadRequestException('Cần đồng ý lưu riêng ảnh chuyển khoản.');
    }
    const record = await this.readIntent(id, tipId, token);
    if (record.status !== 'SELF_REPORTED') {
      throw new ConflictException('Vui lòng đánh dấu đã chuyển khoản trước khi lưu ảnh.');
    }
    if (record.keepsakePath) throw new ConflictException('Lời cảm ơn đã có một ảnh kỷ niệm.');
    const image = await this.normalizeImage(file, 5 * 1024 * 1024);
    const encrypted = this.encryptKeepsake(image);
    const path = `moc-maria/provider-tips/private-keepsakes/${id}/${tipId}.bin`;
    await this.bunnyPut(path, encrypted, 'application/octet-stream');
    const updated = await this.db.query<{ key: string }[]>(
      `UPDATE app_metadata SET
        value=jsonb_set(jsonb_set(value,'{keepsakePath}',to_jsonb($3::text)),'{keepsakeAt}',to_jsonb($4::text)),
        updated_at=clock_timestamp()
       WHERE key=$1 AND value->>'tokenHash'=$2 AND value->>'status'='SELF_REPORTED'
         AND (value->>'keepsakePath') IS NULL
       RETURNING key`,
      [intentKey(tipId), this.tokenDigest(token), path, new Date().toISOString()],
    );
    if (!updated.length) throw new ConflictException('Ảnh kỷ niệm đã được lưu ở nơi khác.');
    return { saved: true };
  }

  async privateKeepsake(actor: AuthUserContext, id: string, tipId: string): Promise<Buffer> {
    await this.ownerOrAdmin(actor, id);
    const record = await this.readIntent(id, tipId);
    if (!record.keepsakePath)
      throw new NotFoundException('Chưa có ảnh kỷ niệm cho lời cảm ơn này.');
    const config = this.storage();
    let response: Response;
    try {
      response = await fetch(`${config.endpoint}/${record.keepsakePath}`, {
        headers: { AccessKey: config.key },
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new BadGatewayException('Chưa thể đọc ảnh kỷ niệm từ kho lưu trữ.');
    }
    if (!response.ok) throw new BadGatewayException('Không tìm được ảnh kỷ niệm.');
    return this.decryptKeepsake(Buffer.from(await response.arrayBuffer()));
  }

  async report(
    actor: AuthUserContext,
    id: string,
  ): Promise<{
    intents: number;
    selfReported: number;
    selfReportedVnd: number;
    verifiedVnd: null;
  }> {
    await this.ownerOrAdmin(actor, id);
    const [row] = await this.db.query<
      {
        intents: string;
        selfReported: string;
        selfReportedVnd: string;
      }[]
    >(
      `SELECT count(*)::text AS intents,
        count(*) FILTER (WHERE value->>'status'='SELF_REPORTED')::text AS "selfReported",
        COALESCE(sum((value->>'amountVnd')::bigint) FILTER
          (WHERE value->>'status'='SELF_REPORTED'),0)::text AS "selfReportedVnd"
       FROM app_metadata WHERE key LIKE 'mocmaria.ktv.tip.intent.v1.%'
         AND value->>'providerId'=$1`,
      [id],
    );
    // No transfer verification integration exists; never report guesses as revenue.
    return {
      intents: Number(row?.intents ?? 0),
      selfReported: Number(row?.selfReported ?? 0),
      selfReportedVnd: Number(row?.selfReportedVnd ?? 0),
      verifiedVnd: null,
    };
  }
}
