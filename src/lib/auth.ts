import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/auth-schema";

export const createAuth = (env: Env) => {
  // Validate BETTER_AUTH_URL: sometimes a secret value was accidentally
  // stored into BETTER_AUTH_URL. Only accept it if it looks like a URL.
  const providedBase = (env as any).BETTER_AUTH_URL;
  let baseURL = "https://nanotype-db.josh-f96.workers.dev";
  if (providedBase && typeof providedBase === "string") {
    if (providedBase.startsWith("http://") || providedBase.startsWith("https://")) {
      baseURL = providedBase;
    } else {
      // Log a warning to help debugging (will appear in worker logs)
      console.warn("Ignoring invalid BETTER_AUTH_URL value (not a URL)", providedBase);
    }
  }

  return betterAuth({
    database: drizzleAdapter(drizzle(env.AUTH_DB), {
      provider: "sqlite",
      schema: schema,
    }),
    emailAndPassword: { enabled: true },
    secret: env.BETTER_AUTH_SECRET || "PLACEHOLDER_SECRET_FOR_DEV",
    baseURL,
  });
};
