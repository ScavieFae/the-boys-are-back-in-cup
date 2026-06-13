import { cookies } from "next/headers";
import crypto from "crypto";

const COOKIE = "tbab_admin";

function token(pw: string): string {
  return crypto.createHash("sha256").update(`tbab:${pw}`).digest("hex");
}

// When ADMIN_PASSWORD is unset (local dev) the admin area is open for convenience.
// In production the env var MUST be set or anyone can edit scores.
export function adminPasswordSet(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD);
}

export async function isAdmin(): Promise<boolean> {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return true;
  const jar = await cookies();
  return jar.get(COOKIE)?.value === token(pw);
}

export async function signIn(password: string): Promise<boolean> {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || password !== expected) return false;
  const jar = await cookies();
  jar.set(COOKIE, token(expected), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return true;
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}
