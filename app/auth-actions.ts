"use server";

import { signIn, signOut } from "@/auth";

export async function signInAction() {
  // Sends the user through the Google OAuth flow, then back to "/".
  await signIn("google", { redirectTo: "/" });
}

export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}
