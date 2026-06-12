/** Default app origin for local development when NEXT_PUBLIC_APP_URL is unset. */
export const DEFAULT_APP_URL = "http://localhost:3000";

export function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL?.trim() || DEFAULT_APP_URL;
}
