import "next-auth";
import "next-auth/jwt";

// Augment the session/JWT with the resolved manager identity so server code
// can read `session.user.manager` and `session.user.personId`.
declare module "next-auth" {
  interface Session {
    user: {
      manager?: string | null;
      personId?: number | null;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    manager?: string | null;
    personId?: number | null;
  }
}
