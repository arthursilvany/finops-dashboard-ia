"use client";

import { useUser } from "@/hooks/useUser";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/**
 * Signed-in identity and sign-out entry point.
 *
 * Sign-out goes to the Easy Auth endpoint (`/.auth/logout`), which clears the
 * platform session cookie. There is no app-managed session to clear.
 */
export function UserMenu() {
  const { user, isLoading, isAdmin } = useUser();

  if (isLoading || !user) return null;

  const isLocalDev = user.source === "local-dev";

  return (
    <div className="rounded-lg bg-white/5 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-500/20 text-[10px] font-semibold text-sky-300">
          {initials(user.name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-slate-200">
            {user.name}
          </p>
          <p className="truncate text-[10px] text-slate-500">
            {isLocalDev ? "Auth disabled (local dev)" : user.email}
          </p>
        </div>
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
            isAdmin
              ? "bg-emerald-500/20 text-emerald-300"
              : "bg-slate-500/20 text-slate-300"
          }`}
          title={
            isAdmin
              ? "Full access, including remediation and configuration"
              : "Read-only access"
          }
        >
          {isAdmin ? "Admin" : "Reader"}
        </span>
      </div>

      {user.authEnforced ? (
        <a
          href="/.auth/logout?post_logout_redirect_uri=/"
          className="mt-2 block rounded px-1 py-1 text-[11px] text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200"
        >
          Sign out
        </a>
      ) : null}
    </div>
  );
}
