import { auth, authConfigured } from "@/auth";
import { signInAction, signOutAction } from "@/app/auth-actions";
import { styleFor } from "@/lib/managers";

// Small server component rendered in the header. Shows a Google sign-in button
// when logged out, or the manager's name (in their color) + sign-out when in.
// Renders without crashing when Google credentials are unset — the button is
// disabled with a hint instead.
export default async function AuthControl() {
  const session = authConfigured ? await auth() : null;
  const manager = session?.user?.manager;

  if (manager) {
    const style = styleFor(manager);
    return (
      <form action={signOutAction} className="flex items-center gap-2 shrink-0">
        <span
          className={`px-2 py-0.5 rounded-md text-xs font-medium ${style.chip}`}
          title={session?.user?.email ?? undefined}
        >
          {manager}
        </span>
        <button
          type="submit"
          className="text-xs text-zinc-400 hover:text-white transition whitespace-nowrap"
        >
          Sign out
        </button>
      </form>
    );
  }

  if (!authConfigured) {
    return (
      <span
        className="text-xs text-zinc-600 whitespace-nowrap shrink-0"
        title="Google sign-in is not configured yet (set AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET)."
      >
        Sign in
      </span>
    );
  }

  return (
    <form action={signInAction} className="shrink-0">
      <button
        type="submit"
        className="text-xs px-2.5 py-1 rounded-md bg-white/5 text-zinc-300 hover:text-white hover:bg-white/10 transition whitespace-nowrap"
      >
        Sign in with Google
      </button>
    </form>
  );
}
