import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database…');

  // Wipe existing data (dev only)
  await prisma.workspaceMember.deleteMany();
  await prisma.sheet.deleteMany();
  await prisma.workspace.deleteMany();
  await prisma.user.deleteMany();

  const passwordHash = await bcrypt.hash('password123', 12);

  const user = await prisma.user.create({
    data: {
      email: 'test@example.com',
      passwordHash,
      name: 'Test User',
    },
  });

  const workspace = await prisma.workspace.create({
    data: {
      name: 'My Workspace',
      ownerId: user.id,
      members: {
        create: { userId: user.id, role: 'owner' },
      },
    },
  });

  await prisma.sheet.createMany({
    data: [
      { workspaceId: workspace.id, name: 'Untitled Sheet' },
      { workspaceId: workspace.id, name: 'Architecture Diagram' },
    ],
  });

  console.log('Seed complete.');
  console.log(`  user:      ${user.email}  /  password123`);
  console.log(`  workspace: ${workspace.name} (${workspace.id})`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
