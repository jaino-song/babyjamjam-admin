import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaService } from 'infrastructure/database/prisma.service';
import { SYSTEM_TEMPLATE_REGISTRY, SystemTemplateKey } from 'domain/constants/system-template-registry';

@Injectable()
export class SystemTemplateBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(SystemTemplateBootstrapService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.seedDefaultTemplates();
  }

  private async seedDefaultTemplates() {
    const count = await this.prisma.system_template.count();

    if (count > 0) {
      this.logger.log(`System templates already exist (${count} found), skipping seed.`);
      return;
    }

    this.logger.log('Seeding default system templates...');

    for (const key of Object.values(SystemTemplateKey)) {
      const contract = SYSTEM_TEMPLATE_REGISTRY[key];

      const template = await this.prisma.system_template.create({
        data: {
          templateKey: key,
          content: contract.defaultContent,
        },
      });

      await this.prisma.system_template_version.create({
        data: {
          templateId: template.id,
          content: contract.defaultContent,
          versionNumber: 1,
          createdBy: 'system',
        },
      });

      this.logger.log(`Seeded template: ${key}`);
    }

    this.logger.log('System templates seeded successfully.');
  }
}
