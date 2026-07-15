import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { createPrismaClientConfig } from "./prisma-url.utils";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly appliedDefaults: string[];
  private readonly missingRequiredEnvVars: string[];

  constructor() {
    const config = createPrismaClientConfig();
    super(config.options);
    this.appliedDefaults = config.appliedDefaults;
    this.missingRequiredEnvVars = config.missingRequiredEnvVars;
  }

  async onModuleInit() {
    if (this.missingRequiredEnvVars.length > 0) {
      const error = new Error(
        `Missing required environment variables: ${this.missingRequiredEnvVars.join(", ")}. ` +
        "Create backend/.env (or export them in your shell) before starting the backend.",
      );
      this.logger.error("Failed to connect to database", error);
      throw error;
    }

    if (this.appliedDefaults.length > 0) {
      this.logger.log(
        `Applied Prisma pooler defaults: ${this.appliedDefaults.join(", ")}`,
      );
    }

    try {
      await this.$connect();
      this.logger.log("Successfully connected to database");
    } catch (error) {
      this.logger.error("Failed to connect to database", error);
      throw error;
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
