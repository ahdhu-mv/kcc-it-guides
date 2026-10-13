import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { getSession } from "@/lib/page";
import { getServices } from "@/lib/services";

export const metadata: Metadata = { title: "KCC Guides Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { session } = await getSession();
  const user = session?.user;
  const { guidesSiteUrl: site, authPortalUrl } = getServices().cfg;
  // Authelia ends the single sign-on session, then sends the person to the public guides site.
  const signOut = `${authPortalUrl}/logout?rd=${encodeURIComponent(site + "/")}`;
  return (
    <html lang="en">
      <head>{session && <meta name="csrf-token" content={session.csrf} />}</head>
      <body>
        <header className="top">
          <div className="wrap top-in">
            <Link className="brand" href="/"><span className="dot" />KCC Guides <b>Admin</b></Link>
            {user && (
              <>
                <nav>
                  <Link href="/">My guides</Link>
                  {user.isAdmin && <Link href="/admin/departments">Departments</Link>}
                  {user.isAdmin && <Link href="/admin/users">People</Link>}
                  {user.isAdmin && <Link href="/admin/audit">Activity</Link>}
                  <Link href="/help">Help</Link>
                  <a href={site} target="_blank" rel="noopener">View site ↗</a>
                </nav>
                <span className="who" title={user.username}>
                  {user.name}{user.isAdmin && <> <em>admin</em></>}
                </span>
                <a className="signout" href={signOut}>Sign out</a>
              </>
            )}
          </div>
        </header>
        <main className="wrap">{children}</main>
      </body>
    </html>
  );
}
