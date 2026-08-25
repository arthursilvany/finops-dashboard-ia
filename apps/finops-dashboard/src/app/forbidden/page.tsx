import "../(dashboard)/globals.css";

export const dynamic = "force-dynamic";

/**
 * Shown when a user signs in successfully but has no app role assigned (or
 * lacks the role required by the page they requested). Deliberately outside the
 * dashboard layout: without a role every data fetch would fail, so rendering
 * the full shell would only produce a wall of errors.
 */
export default async function ForbiddenPage({
  searchParams,
}: {
  searchParams: Promise<{ required?: string }>;
}) {
  const { required = "Reader" } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-lg rounded-lg border border-slate-700 bg-slate-900 p-8 text-slate-100">
        <h1 className="mb-3 text-2xl font-semibold">Access denied</h1>
        <p className="mb-4 text-sm text-slate-300">
          You are signed in, but your account does not have the{" "}
          <span className="font-mono font-semibold">FinOps.{required}</span> app
          role for this dashboard.
        </p>
        <p className="mb-6 text-sm text-slate-400">
          Ask an administrator to assign you a role in the enterprise
          application associated with this deployment.
        </p>
        <a
          className="inline-block rounded-md bg-slate-700 px-4 py-2 text-sm font-medium hover:bg-slate-600"
          href="/.auth/logout?post_logout_redirect_uri=/"
        >
          Sign out
        </a>
      </div>
    </main>
  );
}
