/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- Supertest response.body and Nest HTTP server are typed as any by their libraries. */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { DataSource, In } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/bootstrap/configure-application';
import { AuditLog } from '../src/modules/identity/entities/audit-log.entity';
import { Role } from '../src/modules/identity/entities/role.entity';
import { StaffProfile } from '../src/modules/identity/entities/staff-profile.entity';
import { UserRole } from '../src/modules/identity/entities/user-role.entity';
import { User } from '../src/modules/identity/entities/user.entity';

describe('Auth and RBAC (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const createdUserIds: string[] = [];
  const suffix = Date.now().toString();
  const customerEmail = 'phase2-customer-' + suffix + '@mocmaria.test';
  const superEmail = 'phase2-super-' + suffix + '@mocmaria.test';
  const therapistEmail = 'phase2-therapist-' + suffix + '@mocmaria.test';
  const adminEmail = 'phase2-admin-' + suffix + '@mocmaria.test';
  const customerPassword = 'CustomerTest1234';
  const customerNewPassword = 'CustomerNew1234';
  const superPassword = 'SuperAdminTest1234';
  const therapistPassword = 'TherapistTest1234';
  const adminPassword = 'AdminTest1234';

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test';
    process.env['SWAGGER_ENABLED'] = 'false';

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApplication(app);
    await app.init();
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized && createdUserIds.length > 0) {
      await dataSource
        .getRepository(AuditLog)
        .delete([{ actorUserId: In(createdUserIds) }, { targetUserId: In(createdUserIds) }]);
      await dataSource.getRepository(User).delete({ id: In(createdUserIds) });
    }
    await app?.close();
  });

  it('registers a customer, blocks admin access, rotates refresh, and revokes logout', async () => {
    const agent = request.agent(app.getHttpServer());
    const register = await agent
      .post('/api/v1/auth/register')
      .send({
        displayName: 'Phase 2 Customer',
        email: customerEmail,
        phone: '0912345678',
        password: customerPassword,
      })
      .expect(201);

    expect(register.body.user.roles).toEqual(['CUSTOMER']);
    expect(register.body.accessToken).toEqual(expect.any(String));
    createdUserIds.push(register.body.user.id);

    await agent
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer ' + register.body.accessToken)
      .expect(200);

    await agent
      .get('/api/v1/customers/me')
      .set('Authorization', 'Bearer ' + register.body.accessToken)
      .expect(200);

    await agent
      .get('/api/v1/admin/users/roles')
      .set('Authorization', 'Bearer ' + register.body.accessToken)
      .expect(403);

    const refresh = await agent.post('/api/v1/auth/refresh').expect(200);
    expect(refresh.body.accessToken).toEqual(expect.any(String));
    expect(refresh.body.accessToken).not.toBe(register.body.accessToken);

    await agent.post('/api/v1/auth/logout').expect(204);

    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer ' + refresh.body.accessToken)
      .expect(401);
  });

  it('supports forgot/reset password and revokes previous sessions', async () => {
    const agent = request.agent(app.getHttpServer());
    const login = await agent
      .post('/api/v1/auth/login')
      .send({ identifier: customerEmail, password: customerPassword })
      .expect(200);

    const forgot = await agent
      .post('/api/v1/auth/forgot-password')
      .send({ identifier: customerEmail })
      .expect(202);
    expect(forgot.body.debugResetToken).toEqual(expect.any(String));

    await agent
      .post('/api/v1/auth/reset-password')
      .send({ token: forgot.body.debugResetToken, newPassword: customerNewPassword })
      .expect(204);

    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer ' + login.body.accessToken)
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identifier: customerEmail, password: customerNewPassword })
      .expect(200);
  });

  it('allows SUPER_ADMIN provisioning and blocks THERAPIST privilege escalation', async () => {
    const superUserId = await createSuperAdmin();
    createdUserIds.push(superUserId);

    const superAgent = request.agent(app.getHttpServer());
    const superLogin = await superAgent
      .post('/api/v1/auth/login')
      .send({ identifier: superEmail, password: superPassword })
      .expect(200);

    expect(superLogin.body.user.roles).toContain('SUPER_ADMIN');

    const staff = await superAgent
      .post('/api/v1/admin/users/staff')
      .set('Authorization', 'Bearer ' + superLogin.body.accessToken)
      .send({
        displayName: 'Phase 2 Therapist',
        publicName: 'Therapist Phase 2',
        email: therapistEmail,
        password: therapistPassword,
        role: 'THERAPIST',
        isPublic: true,
      })
      .expect(201);

    createdUserIds.push(staff.body.id);
    expect(staff.body.roles).toEqual(['THERAPIST']);

    const admin = await superAgent
      .post('/api/v1/admin/users/staff')
      .set('Authorization', 'Bearer ' + superLogin.body.accessToken)
      .send({
        displayName: 'Phase 2 Admin',
        publicName: 'Admin Phase 2',
        email: adminEmail,
        password: adminPassword,
        role: 'ADMIN',
        isPublic: false,
      })
      .expect(201);
    createdUserIds.push(admin.body.id);

    const adminAgent = request.agent(app.getHttpServer());
    const adminLogin = await adminAgent
      .post('/api/v1/auth/login')
      .send({ identifier: adminEmail, password: adminPassword })
      .expect(200);

    await adminAgent
      .get('/api/v1/admin/users/roles')
      .set('Authorization', 'Bearer ' + adminLogin.body.accessToken)
      .expect(200);

    await adminAgent
      .patch('/api/v1/admin/users/' + superUserId + '/status')
      .set('Authorization', 'Bearer ' + adminLogin.body.accessToken)
      .send({ isActive: false })
      .expect(403);

    const therapistAgent = request.agent(app.getHttpServer());
    const therapistLogin = await therapistAgent
      .post('/api/v1/auth/login')
      .send({ identifier: therapistEmail, password: therapistPassword })
      .expect(200);

    await therapistAgent
      .get('/api/v1/staff/me')
      .set('Authorization', 'Bearer ' + therapistLogin.body.accessToken)
      .expect(200);

    await therapistAgent
      .get('/api/v1/admin/users/roles')
      .set('Authorization', 'Bearer ' + therapistLogin.body.accessToken)
      .expect(403);

    await therapistAgent
      .patch('/api/v1/admin/users/' + staff.body.id + '/roles')
      .set('Authorization', 'Bearer ' + therapistLogin.body.accessToken)
      .send({ roles: ['ADMIN'] })
      .expect(403);

    await superAgent
      .patch('/api/v1/admin/users/' + staff.body.id + '/status')
      .set('Authorization', 'Bearer ' + superLogin.body.accessToken)
      .send({ isActive: false })
      .expect(200);

    await therapistAgent
      .get('/api/v1/staff/me')
      .set('Authorization', 'Bearer ' + therapistLogin.body.accessToken)
      .expect(401);
  });

  async function createSuperAdmin(): Promise<string> {
    const role = await dataSource.getRepository(Role).findOneOrFail({
      where: { name: 'SUPER_ADMIN' },
    });
    const passwordHash = await argon2.hash(superPassword, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
    const user = await dataSource.getRepository(User).save(
      dataSource.getRepository(User).create({
        email: superEmail,
        phone: null,
        displayName: 'Phase 2 Super Admin',
        passwordHash,
        isActive: true,
        mustChangePassword: false,
        lastLoginAt: null,
      }),
    );
    await dataSource.getRepository(UserRole).save({
      userId: user.id,
      roleId: role.id,
    });
    await dataSource.getRepository(StaffProfile).save({
      userId: user.id,
      publicName: 'Phase 2 Super Admin',
      isActive: true,
      isPublic: false,
      avatarUrl: null,
      bio: null,
    });
    return user.id;
  }
});
