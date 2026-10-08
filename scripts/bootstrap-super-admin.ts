import 'dotenv/config';
import * as argon2 from 'argon2';
import AppDataSource from '../src/database/data-source';
import { StaffProfile } from '../src/modules/identity/entities/staff-profile.entity';
import { Role } from '../src/modules/identity/entities/role.entity';
import { UserRole } from '../src/modules/identity/entities/user-role.entity';
import { User } from '../src/modules/identity/entities/user.entity';

async function main(): Promise<void> {
  const email = process.env['BOOTSTRAP_SUPER_ADMIN_EMAIL']?.trim().toLowerCase();
  const password = process.env['BOOTSTRAP_SUPER_ADMIN_PASSWORD'];
  const displayName = process.env['BOOTSTRAP_SUPER_ADMIN_NAME']?.trim() || 'Mộc Maria Admin';

  if (!email || !password) {
    throw new Error('BOOTSTRAP_SUPER_ADMIN_EMAIL and BOOTSTRAP_SUPER_ADMIN_PASSWORD are required.');
  }
  if (
    password.length < 10 ||
    !/[a-z]/.test(password) ||
    !/[A-Z]/.test(password) ||
    !/\d/.test(password)
  ) {
    throw new Error('Bootstrap password does not meet the project password policy.');
  }

  await AppDataSource.initialize();
  try {
    await AppDataSource.transaction(async (manager) => {
      const users = manager.getRepository(User);
      const roles = manager.getRepository(Role);
      const userRoles = manager.getRepository(UserRole);
      const staffProfiles = manager.getRepository(StaffProfile);

      const role = await roles.findOne({ where: { name: 'SUPER_ADMIN' } });
      if (!role) {
        throw new Error('SUPER_ADMIN role is missing. Run migrations first.');
      }

      let user = await users.findOne({ where: { email } });
      if (!user) {
        const passwordHash = await argon2.hash(password, {
          type: argon2.argon2id,
          memoryCost: 19456,
          timeCost: 2,
          parallelism: 1,
        });
        user = await users.save(
          users.create({
            email,
            phone: null,
            displayName,
            passwordHash,
            isActive: true,
            mustChangePassword: false,
            lastLoginAt: null,
          }),
        );
      }

      await userRoles.upsert(
        { userId: user.id, roleId: role.id },
        { conflictPaths: ['userId', 'roleId'] },
      );

      const staff = await staffProfiles.findOne({ where: { userId: user.id } });
      if (!staff) {
        await staffProfiles.save(
          staffProfiles.create({
            userId: user.id,
            publicName: displayName,
            isActive: true,
            isPublic: false,
            avatarUrl: null,
            bio: null,
          }),
        );
      }

      console.log('SUPER_ADMIN_READY userId=' + user.id);
    });
  } finally {
    await AppDataSource.destroy();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
