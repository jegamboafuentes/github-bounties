export type HomepageCtaKind = "primary" | "secondary" | "ghost";

export type HomepageCta = {
  href: "/board" | "/bounties/new" | "/signin" | "/settings";
  label: string;
  kind: HomepageCtaKind;
};

/** Sign-in / board / post stay on the homepage. Settings replaces Sign in when already signed in. */
export function homepageCtas(signedIn: boolean): HomepageCta[] {
  return [
    { href: "/board", label: "Browse the board", kind: "primary" },
    { href: "/bounties/new", label: "Post a bounty", kind: "secondary" },
    signedIn
      ? { href: "/settings", label: "Settings", kind: "ghost" }
      : { href: "/signin", label: "Sign in", kind: "ghost" },
  ];
}
