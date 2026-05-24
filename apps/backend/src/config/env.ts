import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

const candidateEnvPaths = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../../.env'),
  path.resolve(__dirname, '../../../../.env')
];

for (const envPath of candidateEnvPaths) {
  dotenv.config({ path: envPath });
}

const envSchema = z.object({
  DB_HOST: z.string().default('INCH-VITFS01'),
  DB_PORT: z.coerce.number().default(1433),
  DB_USER: z.string(),
  DB_PASSWORD: z.string(),
  DB_NAME: z.string().default('master'),
  APP_PORT: z.coerce.number().default(4000),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  DB_TARGETS_ENCRYPTION_KEY: z.string().optional(),
  AI_PROVIDER: z.enum(['local', 'openai']).default('local'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4o-mini')
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(`Invalid environment config: ${parsed.error.message}`);
}

export const env = {
  DB_HOST: parsed.data.DB_HOST,
  DB_PORT: parsed.data.DB_PORT,
  DB_USER: parsed.data.DB_USER,
  DB_PASSWORD: parsed.data.DB_PASSWORD,
  DB_NAME: parsed.data.DB_NAME,
  APP_PORT: process.env.APP_PORT || 5000,
  CORS_ORIGIN: parsed.data.CORS_ORIGIN,
  DB_TARGETS_ENCRYPTION_KEY: parsed.data.DB_TARGETS_ENCRYPTION_KEY,
  AI_PROVIDER: parsed.data.AI_PROVIDER,
  OPENAI_API_KEY: parsed.data.OPENAI_API_KEY,
  OPENAI_MODEL: parsed.data.OPENAI_MODEL,
};
