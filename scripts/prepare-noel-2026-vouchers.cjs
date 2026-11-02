/*
 * MOC MARIA / NOEL 2026: one-off, idempotent production-preparation script.
 * Default: read-only plan. --apply --production-ack: prepare a DRAFT campaign.
 * Does NOT issue customer vouchers, activate cash prizes, or publish the campaign.
 * Run inside existing moc-maria-api pod (pg and DATABASE_URL are already available).
 */
'use strict';
const assert = require('node:assert/strict');
const { Client } = require('pg');

const CODE = 'moc-maria-noel-2026';
const SOURCE = 'moc-maria-tri-an-thang-11-2026';
const TITLE = 'Mộc Maria - Giáng Sinh An Lành - Mở Quà Yêu Thương';
const START_AT = '2026-11-30T17:00:00.000Z'; // 01/12/2026 00:00 Asia/Ho_Chi_Minh
const END_AT = '2026-12-25T16:59:59.000Z'; // 25/12/2026 23:59:59 Asia/Ho_Chi_Minh
const PRIZES = [
  { percent: 10, stock: 75, weight: 75, maxDiscountVnd: 150000 },
  { percent: 20, stock: 23, weight: 23, maxDiscountVnd: 200000 },
  { percent: 50, stock: 2, weight: 2, maxDiscountVnd: 300000 },
];
const BUDGET = PRIZES.reduce((total, p) => total + p.stock * p.maxDiscountVnd, 0);
assert(PRIZES.reduce((total, p) => total + p.stock, 0) === 100);
assert(BUDGET === 16450000);
const TERMS = [
  'Chương trình Giáng sinh Mộc Maria 2026, từ 01/12 đến hết 25/12/2026 (giờ Việt Nam).',
  'Mỗi tài khoản khách hàng được mở hộp quà một lần trong sự kiện, theo thể lệ công bố.',
  'Có tổng cộng 100 phần quà voucher: 75 voucher giảm 10%, 23 voucher giảm 20%, 2 voucher giảm 50%.',
  'Giảm giá tối đa tương ứng 150.000đ, 200.000đ và 300.000đ mỗi voucher.',
  'Voucher dùng trong 30 ngày kể từ khi được cấp, áp dụng cho các dịch vụ hoặc đồ uống đủ điều kiện tại cơ sở tham gia.',
  'Khách mở hộp trước, sau đó đặt lịch và sử dụng dịch vụ/đồ uống; nhân viên xác minh voucher khi thanh toán.',
  'Voucher chỉ áp dụng một lần, không cộng dồn ưu đãi và không quy đổi thành tiền mặt.',
  'Vì số lượng từng mức có giới hạn, kết quả dựa trên quay thưởng ngẫu nhiên trên hệ thống và tình trạng kho quà còn lại.',
  'Chương trình mở hộp voucher này không tự động phát thưởng tiền mặt 5.000.000đ; giải thưởng tiền mặt phải có quy trình và thể lệ riêng được phê duyệt.',
].join('\n');

async function main() {
  const apply = process.argv.includes('--apply');
  const acknowledged = process.argv.includes('--production-ack');
  console.log('PLAN=' + JSON.stringify({ code: CODE, mode: apply ? 'APPLY_DRAFT' : 'DRY_RUN', startAt: START_AT, endAt: END_AT, budgetCapVnd: BUDGET, prizes: PRIZES, requiresCompletedServiceBeforeOpening: false, cashPrizeEnabled: false }));
  if (!apply) return;
  assert(acknowledged, 'Add --production-ack when explicitly applying production DRAFT setup.');
  const connectionString = (process.env.DATABASE_URL || '').trim();
  assert(connectionString, 'DATABASE_URL is required; run inside the API pod.');
  const client = new Client({
    connectionString,
    ssl: process.env.DATABASE_SSL === 'false' ? false :
      { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' },
    connectionTimeoutMillis: 9000,
    application_name: 'moc-noel-2026-draft-setup',
  });
  await client.connect();
  let inTransaction = false;
  try {
    await client.query('BEGIN');
    inTransaction = true;
    await client.query("SET LOCAL statement_timeout='15000ms'");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('mocmaria.noel-2026-preparation',0))");
    const source = (await client.query('SELECT id,created_by FROM gift_event_campaigns WHERE code=$1', [SOURCE])).rows[0];
    assert(source, 'Source catalog campaign not found; refuse to guess service IDs and branch.');
    const template = (await client.query(
      `SELECT p.config,p.id FROM gift_event_prizes p WHERE p.event_id=$1::uuid AND p.kind='VOUCHER_PERCENT' AND p.config->>'percent'='10' LIMIT 1`,
      [source.id])).rows[0];
    assert(template && Array.isArray(template.config.allowedServiceIds), 'Source prize has no eligible service IDs');
    const services = [...new Set(template.config.allowedServiceIds)];
    assert(services.length > 0 && services.length <= 100, 'Invalid catalog snapshot');
    const activeServices = (await client.query(
      'SELECT COUNT(*)::int AS n FROM services s JOIN service_categories c ON c.id=s.category_id AND c.is_published WHERE s.id=ANY($1::uuid[]) AND s.is_published',
      [services])).rows[0].n;
    assert(activeServices === services.length, 'Service catalog has changed: not all source services are published');
    const branches = (await client.query(
      'SELECT pb.branch_id FROM gift_event_prize_branches pb JOIN branches b ON b.id=pb.branch_id AND b.is_active WHERE pb.prize_id=$1::uuid',
      [template.id])).rows.map(x => x.branch_id);
    assert(branches.length > 0, 'No active source branch');
    const tiers = (await client.query('SELECT tier_code FROM gift_event_tiers WHERE event_id=$1::uuid', [source.id])).rows.map(x=>x.tier_code);
    assert(tiers.includes('STANDARD') && tiers.length <= 100, 'Expected active customer tiers');
    const existing = (await client.query('SELECT id,status,start_at,end_at,budget_cap_vnd FROM gift_event_campaigns WHERE code=$1 OR slug=$1 FOR UPDATE', [CODE])).rows;
    assert(existing.length <= 1, 'Duplicate campaign identifiers');
    let eventId;
    if (existing.length) {
      const event = existing[0];
      assert(event.status === 'DRAFT', 'Existing event is not DRAFT; do not rewrite');
      assert(new Date(event.start_at).toISOString() === START_AT && new Date(event.end_at).toISOString() === END_AT, 'Existing event dates differ: review manually');
      assert(Number(event.budget_cap_vnd) === BUDGET, 'Existing budget differs: review manually');
      eventId = event.id;
    } else {
      const insert = await client.query(
        `INSERT INTO gift_event_campaigns
         (code,slug,title,description,terms_text,start_at,end_at,budget_cap_vnd,created_by,requires_completed_service)
         VALUES ($1,$1,$2,$3,$4,$5::timestamptz,$6::timestamptz,$7,$8::uuid,FALSE) RETURNING id`,
        [CODE,TITLE,'Sự kiện mở hộp quà Giáng sinh 2026, tối đa 100 voucher giảm giá; chưa công bố và chưa kích hoạt giải tiền mặt.',TERMS,START_AT,END_AT,BUDGET,source.created_by]);
      eventId = insert.rows[0].id;
      for (const tier of tiers) await client.query('INSERT INTO gift_event_tiers(event_id,tier_code) VALUES ($1::uuid,$2)',[eventId,tier]);
    }
    const previousPrizes=(await client.query('SELECT id,name,config,stock_total,stock_issued,weight,enabled FROM gift_event_prizes WHERE event_id=$1::uuid FOR UPDATE',[eventId])).rows;
    for(const prize of PRIZES){
      const name = 'Voucher Noel giảm ' + prize.percent + '% - Mộc Maria';
      const config = {
        percent: prize.percent, minSpendVnd: 0, maxDiscountVnd: prize.maxDiscountVnd,
        validityDays: 30, allowedServiceIds: services,
      };
      const found=previousPrizes.find(p=>p.name===name);
      if(found){
        assert(found.enabled && found.stock_total===prize.stock && found.weight===prize.weight && found.stock_issued===0, 'Prize exists with different state: '+name);
        assert(Number(found.config.percent)===prize.percent && Number(found.config.maxDiscountVnd)===prize.maxDiscountVnd,'Prize configured differently: '+name);
        continue;
      }
      const result=await client.query(
        `INSERT INTO gift_event_prizes
         (event_id,name,description,kind,config,weight,stock_total,liability_vnd,enabled,created_by)
         VALUES($1::uuid,$2,$3,'VOUCHER_PERCENT',$4::jsonb,$5,$6,$7,TRUE,$8::uuid) RETURNING id`,
         [eventId,name,'Voucher Giáng Sinh giảm '+prize.percent+'%, tối đa '+prize.maxDiscountVnd.toLocaleString('vi-VN')+'đ; áp dụng dịch vụ và đồ uống đủ điều kiện.',JSON.stringify(config),prize.weight,prize.stock,prize.maxDiscountVnd,source.created_by]);
      for(const branch of branches)await client.query('INSERT INTO gift_event_prize_branches(prize_id,branch_id) VALUES ($1::uuid,$2::uuid)',[result.rows[0].id,branch]);
    }
    const result=(await client.query(
      `SELECT count(*)::int AS types, sum(stock_total)::int AS stock, sum(stock_issued)::int AS issued,
         sum(stock_total*liability_vnd)::bigint::text AS max_liability
         FROM gift_event_prizes WHERE event_id=$1::uuid AND enabled AND kind='VOUCHER_PERCENT'`,
      [eventId])).rows[0];
    assert(result.types===3 && result.stock===100 && result.issued===0, 'Unexpected final prize pool');
    assert(Number(result.max_liability)===BUDGET,'Prize potential liability exceeds budget');
    await client.query("INSERT INTO audit_logs(event,metadata) VALUES('GIFT_NOEL_2026_DRAFT_PREPARED',$1::jsonb)",[JSON.stringify({campaignCode:CODE,eventId,mode:'operator_preparation',voucherStock:100,distribution:PRIZES.map(p=>({percent:p.percent,stock:p.stock})),published:false,cashEnabled:false})]);
    await client.query('COMMIT');
    inTransaction = false;
    console.log('PREPARED_DRAFT='+JSON.stringify({eventId,code:CODE,status:'DRAFT',configuredVouchers:100,issued:0,distribution:PRIZES,maxBudgetVnd:BUDGET,requiresCompletedService:false,cashAwardActive:false}));
  } catch (e) {
    if (inTransaction) await client.query('ROLLBACK').catch(()=>{});
    throw e;
  } finally { await client.end(); }
}
main().catch(e=>{console.error('PREPARATION_FAILED='+e.message);process.exitCode=1;});
