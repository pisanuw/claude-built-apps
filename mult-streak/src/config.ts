/** Centralized configuration, read once from the environment. */
export interface Config {
  port: number;
  /** Secret used to sign the game-state cookie. */
  cookieSecret: string;
  /** Minutes of inactivity before a player is considered idle. */
  idleMinutes: number;
  /** Path to the JSON activity file. */
  activityFile: string;
  /** Resend + notification settings (email disabled unless all present). */
  resendApiKey?: string;
  adminEmail?: string;
  fromEmail: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const rawSecret = env.COOKIE_SECRET?.trim();
  if (!rawSecret && env.NODE_ENV === 'production') {
    throw new Error('COOKIE_SECRET must be set in production. Refusing to start.');
  }
  return {
    port: Number(env.PORT ?? 3000),
    cookieSecret: rawSecret || 'dev-insecure-cookie-secret',
    idleMinutes: Number(env.IDLE_MINUTES ?? 15),
    activityFile: env.ACTIVITY_FILE?.trim() || './data/activity.json',
    // Accept RESEND_API (the name the user configured) or RESEND_API_KEY.
    resendApiKey: (env.RESEND_API ?? env.RESEND_API_KEY)?.trim() || undefined,
    adminEmail: env.ADMIN_EMAIL?.trim() || undefined,
    fromEmail: env.FROM_EMAIL?.trim() || 'mult-streak@hintwise.org',
  };
}
