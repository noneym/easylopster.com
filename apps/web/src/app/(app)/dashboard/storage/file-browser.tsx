"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { ArrowsClockwiseIcon, DownloadSimpleIcon, FileIcon, FolderIcon, FolderPlusIcon, TrashIcon, UploadSimpleIcon } from "@phosphor-icons/react";
import { useToast } from "@/components/app/toaster";
import type { StorageEntry } from "@/lib/storage";
import { browseStorage, storageDelete, storageDownloadUrl, storageMkdir } from "./actions";

const fmt = (n?: number) => (n == null ? "" : n >= 1024 * 1024 * 1024 ? `${(n / 1024 / 1024 / 1024).toFixed(2)} GB` : n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

/** Folder-by-folder view of the account's bucket under its prefix: upload, download, delete, new folder. */
export function FileBrowser() {
  const toast = useToast();
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<StorageEntry[]>([]);
  const [nextToken, setNextToken] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async (p: string, append = false, token?: string) => {
    setLoading(true);
    const r = await browseStorage(p, token);
    setLoading(false);
    if (r.error) return setError(r.error);
    setError(null);
    setEntries((prev) => (append ? [...prev, ...r.entries] : r.entries));
    setNextToken(r.nextToken);
  }, []);
  useEffect(() => {
    void load(path);
  }, [path, load]);

  const crumbs = path ? path.split("/") : [];
  const go = (p: string) => {
    setEntries([]);
    setPath(p);
  };

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const list = Array.from(files);
    setUploading({ done: 0, total: list.length });
    let failed = 0;
    for (let i = 0; i < list.length; i++) {
      const f = list[i]!;
      const fd = new FormData();
      fd.set("path", path ? `${path}/${f.name}` : f.name);
      fd.set("file", f);
      const r = await fetch("/api/storage/upload", { method: "POST", body: fd }).catch(() => null);
      if (!r || !r.ok) failed++;
      setUploading({ done: i + 1, total: list.length });
    }
    setUploading(null);
    if (failed) toast.push("error", `${failed} of ${list.length} uploads failed.`);
    else toast.push("success", `${list.length} file${list.length === 1 ? "" : "s"} uploaded.`);
    void load(path);
  }

  function download(e: StorageEntry) {
    start(async () => {
      const r = await storageDownloadUrl(e.path);
      if (r.error || !r.url) return toast.push("error", r.error ?? "Could not create a download link.");
      window.open(r.url, "_blank", "noopener");
    });
  }
  function remove(e: StorageEntry) {
    if (!confirm(e.type === "dir" ? `Delete the folder "${e.name}" and everything in it?` : `Delete "${e.name}"?`)) return;
    start(async () => {
      const r = await storageDelete(e.path, e.type === "dir");
      if (r.error) return toast.push("error", r.error);
      toast.push("success", e.type === "dir" ? `Folder deleted (${r.count} objects).` : "File deleted.");
      void load(path);
    });
  }
  function mkdir() {
    const name = prompt("Folder name");
    if (!name?.trim()) return;
    start(async () => {
      const r = await storageMkdir(path ? `${path}/${name.trim()}` : name.trim());
      if (r.error) return toast.push("error", r.error);
      void load(path);
    });
  }

  return (
    <section className="card">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <nav className="flex items-center gap-1 text-sm min-w-0 flex-1 overflow-x-auto" aria-label="Folder path">
          <button type="button" className={`hover:text-fg ${path ? "text-fg-muted" : "font-medium"}`} onClick={() => go("")}>
            storage
          </button>
          {crumbs.map((c, i) => {
            const p = crumbs.slice(0, i + 1).join("/");
            return (
              <span key={p} className="inline-flex items-center gap-1 min-w-0">
                <span className="text-fg-faint">/</span>
                <button type="button" className={`truncate max-w-[16ch] hover:text-fg ${i === crumbs.length - 1 ? "font-medium" : "text-fg-muted"}`} onClick={() => go(p)}>
                  {c}
                </button>
              </span>
            );
          })}
        </nav>
        <button type="button" className="btn-ghost h-8 px-2 text-xs" onClick={() => void load(path)} disabled={loading}>
          <ArrowsClockwiseIcon size={14} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
        <button type="button" className="btn-ghost h-8 px-2 text-xs" onClick={mkdir} disabled={pending}>
          <FolderPlusIcon size={14} /> New folder
        </button>
        <label className="btn-secondary h-8 px-3 text-xs cursor-pointer">
          <UploadSimpleIcon size={14} weight="bold" /> {uploading ? `Uploading ${uploading.done}/${uploading.total}…` : "Upload"}
          <input ref={fileInput} type="file" multiple className="sr-only" onChange={(e) => void upload(e.target.files)} disabled={!!uploading} />
        </label>
      </div>
      {error ? (
        <p className="px-4 py-6 text-sm text-accent-ink">{error}</p>
      ) : entries.length === 0 && !loading ? (
        <p className="px-4 py-10 text-sm text-fg-muted text-center">Empty folder. Upload files here, or let an agent write them with storage_write.</p>
      ) : (
        <ul className="divide-y divide-line">
          {path && (
            <li>
              <button type="button" className="w-full text-left px-4 py-2.5 text-sm text-fg-muted hover:bg-bg-sunk" onClick={() => go(crumbs.slice(0, -1).join("/"))}>
                ..
              </button>
            </li>
          )}
          {entries.map((e) => (
            <li key={e.path} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-bg-sunk/60">
              {e.type === "dir" ? <FolderIcon size={18} weight="fill" className="shrink-0 text-accent-ink" /> : <FileIcon size={18} className="shrink-0 text-fg-muted" />}
              {e.type === "dir" ? (
                <button type="button" className="flex-1 min-w-0 truncate text-left font-medium hover:underline underline-offset-4" onClick={() => go(e.path)}>
                  {e.name}
                </button>
              ) : (
                <span className="flex-1 min-w-0 truncate">{e.name}</span>
              )}
              <span className="text-xs text-fg-faint tabular-nums w-20 text-right shrink-0">{fmt(e.size)}</span>
              <span className="text-xs text-fg-faint w-32 text-right shrink-0 hidden sm:inline">{e.modifiedAt ? e.modifiedAt.slice(0, 16).replace("T", " ") : ""}</span>
              {e.type === "file" && (
                <button type="button" className="btn-ghost h-8 px-2" onClick={() => download(e)} aria-label={`Download ${e.name}`} disabled={pending}>
                  <DownloadSimpleIcon size={16} />
                </button>
              )}
              <button type="button" className="btn-ghost h-8 px-2 text-accent-ink" onClick={() => remove(e)} aria-label={`Delete ${e.name}`} disabled={pending}>
                <TrashIcon size={16} />
              </button>
            </li>
          ))}
          {nextToken && (
            <li>
              <button type="button" className="w-full px-4 py-2.5 text-sm text-fg-muted hover:bg-bg-sunk" onClick={() => void load(path, true, nextToken)} disabled={loading}>
                Load more…
              </button>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
