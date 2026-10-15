import { BadRequestException } from '@nestjs/common';
import type { AuthUserContext } from '../identity/identity.types';
import { GiftOpenController } from './gift-open.controller';
import { GiftWalletController } from './gift-wallet.controller';
import { GiftRedeemController } from './gift-redeem.controller';
import { GiftAbuseService, GIFT_ALL_BRANCHES_SCOPE } from './gift-abuse.service';
import { GiftOpenService } from './gift-open.service';
import { GiftWalletService } from './gift-wallet.service';
import { GiftRedeemService } from './gift-redeem.service';
import type { OpenGiftDto } from './gift-open.dto';

// Controller unit tests should not bootstrap the JWT dependency graph.
jest.mock('../auth/guards/access-token.guard', () => ({
  AccessTokenGuard: class MockAccessTokenGuard {},
}));

const id = '11111111-1111-4111-8111-111111111111';
const eventId = '22222222-2222-4222-8222-222222222222';
const rewardId = '33333333-3333-4333-8333-333333333333';
const branchId = '44444444-4444-4444-8444-444444444444';
const actor = { id, isActive: true } as AuthUserContext;

function controllers(): {
  abuse: { consume: jest.Mock };
  draw: { open: jest.Mock };
  wallet: { issueQr: jest.Mock };
  counter: { verify: jest.Mock; redeem: jest.Mock };
  open: GiftOpenController;
  qr: GiftWalletController;
  redeem: GiftRedeemController;
} {
  const abuse = { consume: jest.fn().mockResolvedValue(undefined) };
  const draw = { open: jest.fn().mockResolvedValue({ openId: 'test' }) };
  const wallet = { issueQr: jest.fn().mockResolvedValue({ rewardId }) };
  const counter = {
    verify: jest.fn().mockResolvedValue({ status: 'ISSUED' }),
    redeem: jest.fn().mockResolvedValue({ status: 'REDEEMED' }),
  };
  return {
    abuse,
    draw,
    wallet,
    counter,
    open: new GiftOpenController(
      draw as unknown as GiftOpenService,
      abuse as unknown as GiftAbuseService,
    ),
    qr: new GiftWalletController(
      wallet as unknown as GiftWalletService,
      abuse as unknown as GiftAbuseService,
    ),
    redeem: new GiftRedeemController(
      counter as unknown as GiftRedeemService,
      abuse as unknown as GiftAbuseService,
    ),
  };
}

describe('P14 controller enforcement', () => {
  it('checks the actor and event bucket before opening any gift', async () => {
    const { abuse, draw, open } = controllers();
    await open.open(actor, eventId, {} as OpenGiftDto);
    expect(abuse.consume).toHaveBeenCalledWith(actor, 'OPEN', eventId);
    expect(draw.open).toHaveBeenCalledTimes(1);
  });
  it('checks the actor and reward bucket before emitting a fresh QR token', async () => {
    const { abuse, wallet, qr } = controllers();
    await qr.qr(actor, rewardId);
    expect(abuse.consume).toHaveBeenCalledWith(actor, 'ISSUE_QR', rewardId);
    expect(wallet.issueQr).toHaveBeenCalledTimes(1);
  });
  it('checks global AND branch limits before verifying or redeeming QR', async () => {
    const { abuse, counter, redeem } = controllers();
    const verifyDto = { token: 'x'.repeat(43), branchId };
    const redeemDto = { ...verifyDto, idempotencyKey: 'idempotent-claim-001' };
    await redeem.verify(actor, verifyDto);
    await redeem.redeem(actor, redeemDto);
    expect(abuse.consume.mock.calls).toEqual([
      [actor, 'VERIFY', GIFT_ALL_BRANCHES_SCOPE],
      [actor, 'VERIFY', branchId],
      [actor, 'REDEEM', GIFT_ALL_BRANCHES_SCOPE],
      [actor, 'REDEEM', branchId],
    ]);
    expect(counter.verify).toHaveBeenCalledTimes(1);
    expect(counter.redeem).toHaveBeenCalledTimes(1);
  });
  it('never invokes gift issuance or redemption if the limiter rejects the request', async () => {
    const { abuse, draw, wallet, counter, open, qr, redeem } = controllers();
    abuse.consume.mockRejectedValue(new BadRequestException('INVALID_EVENT_REQUEST'));
    await expect(open.open(actor, eventId, {} as OpenGiftDto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(qr.qr(actor, rewardId)).rejects.toBeInstanceOf(BadRequestException);
    await expect(redeem.verify(actor, { branchId, token: 'x'.repeat(43) })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      redeem.redeem(actor, {
        branchId,
        token: 'x'.repeat(43),
        idempotencyKey: 'my-idempotency-key',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(draw.open).not.toHaveBeenCalled();
    expect(wallet.issueQr).not.toHaveBeenCalled();
    expect(counter.verify).not.toHaveBeenCalled();
    expect(counter.redeem).not.toHaveBeenCalled();
  });
});
