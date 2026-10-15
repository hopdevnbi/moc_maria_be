/*
 * Safe V09 QA campaign preparation. Dry-run by default; never writes to production.
 * Example (QA only):
 *   MOC_EVENT_QA_API=https://staging-api.example.com/api/v1
 *   MOC_EVENT_QA_TOKEN=<super-admin-token>
 *   MOC_EVENT_QA_BRANCH_IDS=<verified-branch-uuids>
 *   MOC_EVENT_QA_SERVICE_IDS=<verified-catalog-service-uuids>
 *   node scripts/november-2026-qa-event.cjs --apply --qa-only
 * Do not paste tokens into terminal command arguments or logs.
 */
const assert = require('node:assert/strict');
const isUuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const startAt = '2026-10-31T17:00:00.000Z';
const endAt = '2026-11-30T16:59:00.000Z';
const title = 'Tháng 11 Tri Ân Mộc Maria - Mở Hộp Nhận Yêu Thương';
const code = 'moc-maria-tri-an-thang-11-2026';
const percents = [10, 15, 20, 25, 30];
const campaign = {
  code, slug: code, title,
  description: 'Thử nghiệm nhận voucher khi mở hộp - chương trình chưa phát hành công khai.',
  startAt, endAt, eligibleTiers: ['STANDARD'], budgetCapVnd: 15000000,
  termsText: 'Một lượt nhận voucher trên mỗi tài khoản khách hàng. Voucher giảm giá 10%-30%, tối đa 150.000đ; hạn dùng 30 ngày kể từ khi nhận. Chỉ áp dụng cho dịch vụ và đồ uống được chọn tại cơ sở đủ điều kiện. Không quy đổi tiền mặt, không cộng dồn ưu đãi, yêu cầu nhân viên xác minh và đối chiếu hóa đơn. Đây là chiến dịch thử nghiệm QA.',
};
const branches = (process.env.MOC_EVENT_QA_BRANCH_IDS || '').split(',').map((x) => x.trim()).filter(Boolean);
const services = (process.env.MOC_EVENT_QA_SERVICE_IDS || '').split(',').map((x) => x.trim()).filter(Boolean);
const prizes = percents.map((percent) => ({
  name: `Voucher giảm ${percent}% - Mộc Maria`,
  description: `Giảm ${percent}% các gói massage trị liệu và đồ uống đủ điều kiện, tối đa 150.000đ`,
  kind: 'VOUCHER_PERCENT',
  config: { percent, maxDiscountVnd: 150000, minSpendVnd: 0, validityDays: 30,
    allowedServiceIds: services }, weight: 20, stockTotal: 20, enabled: true, branchIds: branches,
}));

async function main() {
  const apply = process.argv.includes('--apply');
  console.log(JSON.stringify({ mode: apply ? 'QA_APPLY' : 'DRY_RUN', campaign,
    prizes: prizes.map((x) => ({ name: x.name, percent: x.config.percent, stockTotal: x.stockTotal })),
    configuredBranchCount: branches.length, configuredServiceCount: services.length }, null, 2));
  if (!apply) return;
  assert(process.argv.includes('--qa-only'), 'Missing --qa-only acknowledgement');
  const base = process.env.MOC_EVENT_QA_API || '';
  const token = process.env.MOC_EVENT_QA_TOKEN || '';
  const url = new URL(base);
  assert(url.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(url.hostname), 'QA API must be HTTPS');
  assert(!/(^|\.)mocmaria\.com$/i.test(url.hostname) && !/production|(^|\.)api\.giangxa\.com$/i.test(url.hostname),
    'Production host prohibited');
  assert(url.pathname.endsWith('/api/v1'), 'Use explicit QA API /api/v1 base');
  assert(token.length > 30, 'Missing QA-only SUPER_ADMIN token');
  assert(branches.length > 0 && branches.length <= 20 && branches.every(isUuid), 'Verified active QA branch UUIDs required');
  assert(services.length > 0 && services.length <= 100 && services.every(isUuid), 'Verified active QA catalog service UUIDs required');
  const request = async (path, method = 'GET', body) => {
    const response = await fetch(url.toString().replace(/\/$/, '') + path, {
      method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status}`);
    return response.json();
  };
  // Validate every selected UUID against the QA catalog *before* creating a draft.
  const [qaBranches, qaServices] = await Promise.all([
    request('/admin/branches'), request('/admin/services'),
  ]);
  assert(Array.isArray(qaBranches) && Array.isArray(qaServices), 'QA catalog not available');
  const activeBranches = new Set(qaBranches.filter((b) => b.isActive).map((b) => b.id));
  const publishedServices = new Set(qaServices.filter((s) => s.isPublished).map((s) => s.id));
  assert(branches.every((id) => activeBranches.has(id)), 'Selected QA branch is not active');
  assert(services.every((id) => publishedServices.has(id)), 'Selected QA service is not published');
  const existing = await request('/admin/gift-events');
  assert(Array.isArray(existing), 'Unexpected QA event list');
  let event = existing.find((e) => e.code === code);
  if (event && event.status !== 'DRAFT') throw new Error('Existing event is not draft; refusing changes');
  if (!event) event = await request('/admin/gift-events', 'POST', campaign);
  const existingPrizes = await request(`/admin/gift-events/${event.id}/prizes`);
  assert(Array.isArray(existingPrizes), 'Unexpected QA prize list');
  for (const prize of prizes) {
    if (existingPrizes.some((p) => p.name === prize.name)) continue;
    await request(`/admin/gift-events/${event.id}/prizes`, 'POST', prize);
  }
  console.log('QA DRAFT prepared. Event remains unpublished; no customer voucher was issued.');
}
main().catch((error) => { console.error(String(error.message || error)); process.exitCode = 1; });
