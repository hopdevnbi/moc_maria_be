import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import type { AuthUserContext } from '../identity/identity.types';
import { GiftEventsService } from './gift-events.service';
import {
  type CreateGiftPrizeDto,
  type UpdateGiftPrizeDto,
  validateGiftPrize,
  type GiftPrizeKind,
  type PrizeConfig,
} from './gift-prizes.dto';

export type GiftPrizeView = {
  id: string;
  eventId: string;
  name: string;
  description: string;
  kind: GiftPrizeKind;
  config: PrizeConfig;
  weight: number;
  stockTotal: number;
  stockIssued: number;
  liabilityVnd: number;
  enabled: boolean;
  version: number;
  branchIds: string[];
};
type PrizeRow = {
  id: string;
  event_id: string;
  name: string;
  description: string;
  kind: GiftPrizeKind;
  config: PrizeConfig;
  weight: number;
  stock_total: number;
  stock_issued: number;
  liability_vnd: string;
  enabled: boolean;
  version: number;
};

@Injectable()
export class GiftPrizesService {
  constructor(
    private readonly db: DataSource,
    private readonly events: GiftEventsService,
  ) {}
  private async prize(
    m: EntityManager,
    eventId: string,
    id: string,
    lock = false,
  ): Promise<PrizeRow> {
    const [row] = await m.query<PrizeRow[]>(
      `SELECT * FROM gift_event_prizes WHERE id=$1::uuid AND event_id=$2::uuid${lock ? ' FOR UPDATE' : ''}`,
      [id, eventId],
    );
    if (!row) throw new NotFoundException('Không tìm thấy quà.');
    return row;
  }
  private async present(m: EntityManager, row: PrizeRow): Promise<GiftPrizeView> {
    const branches = await m.query<Array<{ branch_id: string }>>(
      'SELECT branch_id FROM gift_event_prize_branches WHERE prize_id=$1::uuid ORDER BY branch_id',
      [row.id],
    );
    return {
      id: row.id,
      eventId: row.event_id,
      name: row.name,
      description: row.description,
      kind: row.kind,
      config: row.config,
      weight: Number(row.weight),
      stockTotal: Number(row.stock_total),
      stockIssued: Number(row.stock_issued),
      liabilityVnd: Number(row.liability_vnd),
      enabled: row.enabled,
      version: Number(row.version),
      branchIds: branches.map((b) => b.branch_id),
    };
  }
  async list(actor: AuthUserContext, eventId: string): Promise<GiftPrizeView[]> {
    this.events.requireAdmin(actor);
    this.events.requireEnabled();
    await this.events.detail(actor, eventId);
    const rows = await this.db.query<PrizeRow[]>(
      'SELECT * FROM gift_event_prizes WHERE event_id=$1::uuid ORDER BY created_at DESC',
      [eventId],
    );
    const out: GiftPrizeView[] = [];
    for (const row of rows) out.push(await this.present(this.db.manager, row));
    return out;
  }
  async create(
    actor: AuthUserContext,
    eventId: string,
    dto: CreateGiftPrizeDto,
  ): Promise<GiftPrizeView> {
    this.events.requireAdmin(actor);
    this.events.requireEnabled();
    const branches = [...new Set(dto.branchIds ?? [])];
    if (!branches.length) throw new BadRequestException('Cần chọn ít nhất một cơ sở nhận quà.');
    let rules;
    try {
      rules = validateGiftPrize(dto.kind, dto.config, dto.enabled === true);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const id = await this.db.transaction(async (m) => {
      const [event] = await m.query<Array<{ status: string }>>(
        'SELECT status FROM gift_event_campaigns WHERE id=$1::uuid FOR UPDATE',
        [eventId],
      );
      if (!event) throw new NotFoundException('Không tìm thấy sự kiện.');
      if (event.status !== 'DRAFT' && event.status !== 'PAUSED')
        throw new ConflictException('Chỉ thêm quà khi sự kiện nháp hoặc tạm dừng.');
      const [{ n }] = await m.query<Array<{ n: number }>>(
        'SELECT COUNT(*)::int n FROM branches WHERE id=ANY($1::uuid[]) AND is_active',
        [branches],
      );
      if (Number(n) !== branches.length)
        throw new BadRequestException('Cơ sở không hợp lệ hoặc đã tắt.');
      const [row] = await m.query<Array<{ id: string }>>(
        `INSERT INTO gift_event_prizes
        (event_id,name,description,kind,config,weight,stock_total,liability_vnd,enabled,created_by)
        VALUES($1::uuid,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10::uuid) RETURNING id`,
        [
          eventId,
          dto.name.trim(),
          dto.description?.trim() || '',
          dto.kind,
          JSON.stringify(rules.config),
          dto.weight,
          dto.stockTotal,
          rules.liabilityVnd,
          dto.enabled === true && dto.kind !== 'CASH_COUNTER',
          actor.id,
        ],
      );
      for (const branchId of branches)
        await m.query(
          'INSERT INTO gift_event_prize_branches(prize_id,branch_id) VALUES($1::uuid,$2::uuid)',
          [row.id, branchId],
        );
      await m.query(
        `INSERT INTO gift_event_admin_audit(event_id,actor_user_id,action,reason,before_snapshot,after_snapshot)
        VALUES($1::uuid,$2::uuid,'PRIZE_CREATED',$3,'{}'::jsonb,$4::jsonb)`,
        [
          eventId,
          actor.id,
          'Thêm phần thưởng ' + dto.name,
          JSON.stringify({ prizeId: row.id, kind: dto.kind, stockTotal: dto.stockTotal }),
        ],
      );
      return row.id;
    });
    return this.get(actor, eventId, id);
  }
  async get(actor: AuthUserContext, eventId: string, id: string): Promise<GiftPrizeView> {
    this.events.requireAdmin(actor);
    this.events.requireEnabled();
    return this.present(this.db.manager, await this.prize(this.db.manager, eventId, id));
  }
  async update(
    actor: AuthUserContext,
    eventId: string,
    id: string,
    dto: UpdateGiftPrizeDto,
  ): Promise<GiftPrizeView> {
    this.events.requireAdmin(actor);
    this.events.requireEnabled();
    await this.db.transaction(async (m) => {
      const [event] = await m.query<Array<{ status: string }>>(
        'SELECT status FROM gift_event_campaigns WHERE id=$1::uuid FOR UPDATE',
        [eventId],
      );
      if (!event) throw new NotFoundException('Không tìm thấy sự kiện.');
      const row = await this.prize(m, eventId, id, true);
      if (Number(row.version) !== dto.expectedVersion)
        throw new ConflictException('Quà vừa được sửa; hãy tải lại.');
      if (!['DRAFT', 'PAUSED'].includes(event.status))
        throw new ConflictException('Muốn chỉnh quà hãy tạm dừng event trước.');
      const stock = dto.stockTotal ?? Number(row.stock_total);
      if (stock < Number(row.stock_issued))
        throw new BadRequestException('Không được giảm tồn thấp hơn số quà đã phát.');
      const enabled = dto.enabled ?? row.enabled,
        config = dto.config ?? row.config;
      let rules;
      try {
        rules = validateGiftPrize(row.kind, config, enabled);
      } catch (e) {
        throw new BadRequestException((e as Error).message);
      }
      const branches =
        dto.branchIds === undefined
          ? (
              await m.query<Array<{ branch_id: string }>>(
                'SELECT branch_id FROM gift_event_prize_branches WHERE prize_id=$1::uuid',
                [id],
              )
            ).map((x) => x.branch_id)
          : [...new Set(dto.branchIds)];
      if (!branches.length) throw new BadRequestException('Cần ít nhất một cơ sở nhận.');
      const [{ n }] = await m.query<Array<{ n: number }>>(
        'SELECT COUNT(*)::int n FROM branches WHERE id=ANY($1::uuid[]) AND is_active',
        [branches],
      );
      if (Number(n) !== branches.length) throw new BadRequestException('Cơ sở không hợp lệ.');
      await m.query(
        `UPDATE gift_event_prizes SET name=$2,description=$3,config=$4::jsonb,weight=$5,
        stock_total=$6,liability_vnd=$7,enabled=$8,version=version+1,updated_at=clock_timestamp()
        WHERE id=$1::uuid`,
        [
          id,
          dto.name?.trim() ?? row.name,
          dto.description?.trim() ?? row.description,
          JSON.stringify(rules.config),
          dto.weight ?? row.weight,
          stock,
          rules.liabilityVnd,
          enabled,
        ],
      );
      if (dto.branchIds !== undefined) {
        await m.query('DELETE FROM gift_event_prize_branches WHERE prize_id=$1::uuid', [id]);
        for (const branchId of branches)
          await m.query(
            'INSERT INTO gift_event_prize_branches(prize_id,branch_id) VALUES($1::uuid,$2::uuid)',
            [id, branchId],
          );
      }
      await m.query(
        `INSERT INTO gift_event_admin_audit(event_id,actor_user_id,action,reason,before_snapshot,after_snapshot)
        VALUES($1::uuid,$2::uuid,'PRIZE_UPDATED',$3,$4::jsonb,$5::jsonb)`,
        [
          eventId,
          actor.id,
          dto.reason,
          JSON.stringify({
            version: row.version,
            stockTotal: row.stock_total,
            enabled: row.enabled,
          }),
          JSON.stringify({ version: Number(row.version) + 1, stockTotal: stock, enabled }),
        ],
      );
    });
    return this.get(actor, eventId, id);
  }
}
