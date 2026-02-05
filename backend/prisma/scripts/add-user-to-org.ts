// Run with: npx ts-node prisma/scripts/add-user-to-org.ts <user-email-or-id>

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const userIdentifier = process.argv[2];

  if (!userIdentifier) {
    console.log('Usage: npx ts-node prisma/scripts/add-user-to-org.ts <user-email-or-id>');
    process.exit(1);
  }

  // Find user
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { id: userIdentifier },
        { email: userIdentifier },
      ]
    }
  });

  if (!user) {
    console.error('User not found:', userIdentifier);
    process.exit(1);
  }

  console.log('Found user:', user.email || user.id);

  // Find organization
  const org = await prisma.organization.findFirst();

  if (!org) {
    console.error('No organization found. Run migrate-to-multi-tenancy-clean.ts first.');
    process.exit(1);
  }

  console.log('Found org:', org.name);

  // Check if already linked
  const existing = await prisma.user_organization.findFirst({
    where: { userId: user.id, organizationId: org.id }
  });

  if (existing) {
    console.log('User already linked to organization');
    return;
  }

  // Create link
  await prisma.user_organization.create({
    data: {
      id: crypto.randomUUID(),
      userId: user.id,
      organizationId: org.id,
      role: 'admin',
    }
  });

  console.log('✓ User linked to organization as admin');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
