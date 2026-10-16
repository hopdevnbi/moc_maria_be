import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RedeemGiftCodeDto, RedeemGiftDto } from './gift-redeem.dto';

describe('Optional voucher internal reference DTO', () => {
  const base = {
    branchId: '11111111-1111-4111-8111-111111111111',
    idempotencyKey: 'isolated-redemption-key',
    items: [{ variantId: '22222222-2222-4222-8222-222222222222', quantity: 1 }],
  };
  it.each([undefined, '', '   ', '1', 'Ca chiều / phiếu 1'])(
    'accepts optional reference %p for both credentials',
    async (saleReference) => {
      for (const dto of [
        plainToInstance(RedeemGiftDto, { ...base, token: 'Q'.repeat(43), saleReference }),
        plainToInstance(RedeemGiftCodeDto, { ...base, code: '123456', saleReference }),
      ])
        expect(await validate(dto)).toEqual([]);
    },
  );
  it('retains the input length bound', async () => {
    const errors = await validate(
      plainToInstance(RedeemGiftCodeDto, {
        ...base,
        code: '123456',
        saleReference: 'a'.repeat(101),
      }),
    );
    expect(errors.map((error) => error.property)).toContain('saleReference');
  });
});
