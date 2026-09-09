import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      googleSub: string;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    googleSub?: string;
  }
}
