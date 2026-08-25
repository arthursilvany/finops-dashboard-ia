import useSWR from "swr";
import type { AppRole, PrincipalSource } from "@/lib/auth";

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  roles: AppRole[];
  source: PrincipalSource;
  authEnforced: boolean;
}

async function fetcher(url: string): Promise<CurrentUser | null> {
  const res = await fetch(url);
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  const json = await res.json();
  return json.data as CurrentUser;
}

/**
 * Identity of the signed-in user, plus the derived permission flags used to
 * hide or disable write actions for Readers.
 */
export function useUser() {
  const { data, error, isLoading } = useSWR<CurrentUser | null>(
    "/api/me",
    fetcher,
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const roles = data?.roles ?? [];

  return {
    user: data ?? null,
    isLoading,
    error,
    isAdmin: roles.includes("Admin"),
    canRead: roles.includes("Reader") || roles.includes("Admin"),
  };
}
