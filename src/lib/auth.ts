import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/auth-schema";

export const createAuth = (env: Env) => {
  // Validate BETTER_AUTH_URL: sometimes a secret value was accidentally
  // stored into BETTER_AUTH_URL. Only accept it if it looks like a URL.
  const providedBase = (env as any).BETTER_AUTH_URL;
  
  // SECURITY: No fallback for baseURL - require explicit configuration
  // This prevents accidental production deployments with wrong URLs
  if (!providedBase || typeof providedBase !== "string") {
    throw new Error("BETTER_AUTH_URL environment variable is required");
  }
  
  if (!providedBase.startsWith("http://") && !providedBase.startsWith("https://")) {
    throw new Error("BETTER_AUTH_URL must be a valid URL starting with http:// or https://");
  }

  // SECURITY: Require secret in production, generate random one in development
  let secret = env.BETTER_AUTH_SECRET;
  if (!secret) {
    // Only allow missing secret in development
    const isDev = providedBase.includes('localhost') || providedBase.includes('127.0.0.1');
    if (isDev) {
      // Generate a random secret for development
      secret = `dev-${crypto.randomUUID()}`;
      console.warn('⚠️  Using auto-generated secret for development. Set BETTER_AUTH_SECRET in production!');
    } else {
      throw new Error("BETTER_AUTH_SECRET environment variable is required in production");
    }
  }

  // SECURITY: Parse trusted origins from environment variable
  // Format: comma-separated list of origins
  const trustedOriginsStr = (env as any).TRUSTED_ORIGINS || providedBase;
  const trustedOrigins = trustedOriginsStr
    .split(',')
    .map((origin: string) => origin.trim())
    .filter((origin: string) => origin.length > 0);

  return betterAuth({
    database: drizzleAdapter(drizzle(env.AUTH_DB), {
      provider: "sqlite",
      schema: schema,
    }),
    emailAndPassword: { enabled: true },
    secret,
    baseURL: providedBase,
    trustedOrigins,
  });
};
