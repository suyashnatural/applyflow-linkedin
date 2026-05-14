import { PrismaClient } from "@prisma/client";
import { getConfig } from "@applyflow/config";

let client: PrismaClient | undefined;

export function getDb(): PrismaClient {
  if (client) return client;
  const config = getConfig();
  client = new PrismaClient({
    datasourceUrl: config.databaseUrl,
  });
  return client;
}
