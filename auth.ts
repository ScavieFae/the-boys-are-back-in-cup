import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { managerForEmail } from "@/lib/allowlist";
import { linkEmailToManager, personIdForManager } from "@/lib/people";

// Auth.js (NextAuth v5) with Google + JWT sessions. No DB adapter: the session
// is a signed JWT, and we resolve identity through the AUTH_ALLOWLIST env var.
//
// IMPORTANT: the app must build and run with Google credentials UNSET so the
// live site never breaks before they're configured. When AUTH_GOOGLE_ID /
// AUTH_GOOGLE_SECRET are missing we register no provider — the "Sign in" button
// renders but simply has nothing to redirect to, instead of crashing.

const googleId = process.env.AUTH_GOOGLE_ID;
const googleSecret = process.env.AUTH_GOOGLE_SECRET;

export const authConfigured = Boolean(googleId && googleSecret);

const providers = authConfigured
  ? [Google({ clientId: googleId, clientSecret: googleSecret })]
  : [];

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Auth.js derives a default secret in dev, but set AUTH_SECRET in prod.
  trustHost: true,
  session: { strategy: "jwt" },
  providers,
  callbacks: {
    // Allowlist gate: only emails present in AUTH_ALLOWLIST may sign in.
    async signIn({ user }) {
      const manager = managerForEmail(user.email);
      if (!manager) return false;
      try {
        await linkEmailToManager(manager, user.email!);
      } catch {
        // Don't block sign-in if the DB write fails (e.g. local dev with no DB).
      }
      return true;
    },
    // Resolve and cache the manager identity on the token at sign-in time.
    async jwt({ token }) {
      if (token.manager) return token;
      const manager = managerForEmail(token.email);
      if (manager) {
        token.manager = manager;
        try {
          token.personId = await personIdForManager(manager);
        } catch {
          token.personId = null;
        }
      }
      return token;
    },
    // Expose the manager identity on the session for server/client reads.
    async session({ session, token }) {
      if (session.user) {
        session.user.manager = token.manager ?? null;
        session.user.personId = token.personId ?? null;
      }
      return session;
    },
  },
});
