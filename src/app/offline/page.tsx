import Link from "next/link";

export const metadata = {
  title: "Offline",
};

export default function OfflinePage() {
  return (
    <main className="min-h-screen bg-slate-50 grid place-items-center px-4">
      <div className="card max-w-md p-6 text-center space-y-3">
        <h1 className="text-xl font-semibold text-brand-navy">
          You're offline
        </h1>
        <p className="text-sm text-slate-600">
          The page you wanted needs a connection. Submissions, schedules,
          and dispatch all require the server.
        </p>
        <p className="text-sm text-slate-500">
          When the signal comes back, head to{" "}
          <Link href="/m/today" className="text-brand-mint-dark hover:underline">
            Today
          </Link>{" "}
          and pick up where you left off.
        </p>
      </div>
    </main>
  );
}
