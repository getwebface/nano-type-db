import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/auth-schema";

export const createAuth = (env: Env) => {
  return betterAuth({
    database: drizzleAdapter(drizzle(env.AUTH_DB), {
      provider: "sqlite",
      schema: schema,
    }),
    emailAndPassword: { enabled: true },
    secret: env.BETTER_AUTH_SECRET || "PLACEHOLDER_SECRET_FOR_DEV", 
  });
};
