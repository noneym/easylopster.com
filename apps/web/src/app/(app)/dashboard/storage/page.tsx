import { PageHeader } from "@/components/app/page-header";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { STORAGE_PROVIDERS, credsOf, storageUsage, type StorageProvider } from "@/lib/storage";
import { StorageForm } from "./storage-form";
import { FileBrowser } from "./file-browser";
import { removeStorage } from "./actions";

export const metadata = { title: "Storage" };

const fmt = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

export default async function StoragePage() {
  const user = await requireUser();
  const cfg = await db.storageConfig.findUnique({ where: { userId: user.id } });
  const usage = cfg ? await storageUsage(credsOf(cfg)).catch(() => null) : null;
  const backups = cfg ? await db.backup.count({ where: { userId: user.id } }) : 0;

  return (
    <>
      <PageHeader
        title="Storage"
        description="Your own S3-compatible bucket as a shared drive for all your agents, and the place backups go. We keep only the connection; the data stays in your account with the provider."
      />
      {cfg ? (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="card p-5">
              <p className="text-sm text-fg-muted">Connected</p>
              <p className="mt-1 font-medium">{STORAGE_PROVIDERS[cfg.provider as StorageProvider]?.label ?? cfg.provider}</p>
              <p className="mt-0.5 font-mono text-xs text-fg-muted break-all">
                {cfg.bucket}
                {cfg.prefix ? `/${cfg.prefix}` : ""}
              </p>
            </div>
            <div className="card p-5">
              <p className="text-sm text-fg-muted">In use</p>
              <p className="mt-1 font-medium">{usage ? `${fmt(usage.bytes)}${usage.partial ? "+" : ""}` : "—"}</p>
              <p className="mt-0.5 text-xs text-fg-muted">{usage ? `${usage.objects}${usage.partial ? "+" : ""} objects under the folder` : "could not list the bucket"}</p>
            </div>
            <div className="card p-5">
              <p className="text-sm text-fg-muted">Backups</p>
              <p className="mt-1 font-medium">{backups}</p>
              <p className="mt-0.5 text-xs text-fg-muted">archives across your agents; schedules are set per agent</p>
            </div>
          </div>
          <FileBrowser />
          <details className="card">
            <summary className="cursor-pointer px-6 py-4 font-medium">Connection settings</summary>
            <div className="border-t border-line p-6 space-y-6">
              <StorageForm current={{ provider: cfg.provider, endpoint: cfg.endpoint ?? "", region: cfg.region, bucket: cfg.bucket, prefix: cfg.prefix, forcePathStyle: cfg.forcePathStyle, accessKeyLast4: cfg.accessKeyLast4 }} />
              <form action={removeStorage} className="flex flex-wrap items-center gap-3">
                <button type="submit" className="btn-ghost text-accent-ink">
                  Disconnect storage
                </button>
                <span className="text-xs text-fg-muted">Removes the connection here only; nothing in the bucket is deleted. Scheduled backups pause.</span>
              </form>
            </div>
          </details>
          <section className="text-sm text-fg-muted space-y-2">
            <p className="font-medium text-fg">What agents can do with it</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>storage_list, storage_read, storage_write, storage_delete: a shared drive every agent of yours sees; good for hand-offs between agents and files you want to keep outside a workspace.</li>
              <li>storage_copy: move a file between an agent's workspace (inbox, exports) and the bucket in either direction.</li>
              <li>storage_link: a download link valid for 24 hours, handy to send big files on Telegram or the web chat.</li>
            </ul>
          </section>
        </div>
      ) : (
        <div className="max-w-3xl space-y-6">
          <StorageForm current={null} />
          <section className="text-sm text-fg-muted space-y-2">
            <p className="font-medium text-fg">Why bring your own bucket</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Files and backups live in your account with your provider; easylopster only holds the connection, encrypted.</li>
              <li>Cloudflare R2 has no egress fees and a free tier; Amazon S3, Backblaze B2 and any MinIO work the same way.</li>
              <li>Create a key scoped to one bucket. We test read and write before saving.</li>
            </ul>
          </section>
        </div>
      )}
    </>
  );
}
