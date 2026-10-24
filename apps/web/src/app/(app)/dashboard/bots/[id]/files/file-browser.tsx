"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { FileTextIcon, FolderIcon, FolderOpenIcon, PlusIcon, TrashIcon, ArrowClockwiseIcon, CaretRightIcon } from "@phosphor-icons/react";
import { wsDelete, wsRead, wsTree, wsWrite, type Entry } from "./actions";
import { SKILL_TEMPLATE } from "./skill-template";

/** Nested view of the flat entry list: folders first, then files, both sorted. */
type TreeNode = { name: string; path: string; dir: boolean; size: number; children: TreeNode[] };

function buildTree(entries: Entry[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", dir: true, size: 0, children: [] };
  const dirs = new Map<string, TreeNode>([["", root]]);
  const ensureDir = (dirPath: string): TreeNode => {
    const existing = dirs.get(dirPath);
    if (existing) return existing;
    const parts = dirPath.split("/");
    const parent = ensureDir(parts.slice(0, -1).join("/"));
    const node: TreeNode = { name: parts[parts.length - 1]!, path: dirPath, dir: true, size: 0, children: [] };
    parent.children.push(node);
    dirs.set(dirPath, node);
    return node;
  };
  for (const e of entries) {
    const clean = e.path.replace(/\/$/, "");
    if (e.type === "dir") ensureDir(clean);
    else {
      const parts = clean.split("/");
      const parent = ensureDir(parts.slice(0, -1).join("/"));
      parent.children.push({ name: parts[parts.length - 1]!, path: clean, dir: false, size: e.size, children: [] });
    }
  }
  const sortRec = (n: TreeNode) => {
    n.children.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
    n.children.forEach(sortRec);
  };
  sortRec(root);
  return root.children;
}

const fmtSize = (n: number) => (n < 1024 ? `${n}b` : `${Math.round(n / 1024)}k`);

function todayPath() {
  return `memory/${new Date().toISOString().slice(0, 10)}.md`;
}

export function FileBrowser({ botId, initialEntries, initialPath }: { botId: string; initialEntries: Entry[]; initialPath?: string }) {
  const [entries, setEntries] = useState(initialEntries);
  const [path, setPath] = useState<string | null>(initialPath ?? (initialEntries.some((e) => e.path === "MEMORY.md") ? "MEMORY.md" : null));
  const [content, setContent] = useState("");
  const [saved, setSaved] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  // Folders open by default: memory/, skills/ and whatever contains the open file.
  const [openDirs, setOpenDirs] = useState<Set<string>>(() => {
    const init = new Set(["memory", "skills"]);
    const first = initialPath ?? "";
    const parts = first.split("/");
    for (let i = 1; i < parts.length; i++) init.add(parts.slice(0, i).join("/"));
    return init;
  });
  const toggleDir = (d: string) =>
    setOpenDirs((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  const [pending, start] = useTransition();
  const dirty = content !== saved;

  const files = useMemo(() => entries.filter((e) => e.type === "file" && (!filter || e.path.toLowerCase().includes(filter.toLowerCase()))).sort((a, b) => a.path.localeCompare(b.path)), [entries, filter]);
  const tree = useMemo(() => buildTree(entries), [entries]);

  function refresh() {
    start(async () => {
      const t = await wsTree(botId);
      if (!t.error) setEntries(t.entries);
    });
  }

  function open(p: string) {
    if (dirty && !confirm("Discard unsaved changes?")) return;
    start(async () => {
      const r = await wsRead(botId, p);
      if (r.error) {
        setStatus(r.error);
        return;
      }
      setPath(p);
      setContent(r.content ?? "");
      setSaved(r.content ?? "");
      setStatus(null);
    });
  }

  useEffect(() => {
    if (path && !saved && !content) open(path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function save() {
    if (!path) return;
    start(async () => {
      const r = await wsWrite(botId, path, content);
      if (r.error) return setStatus(r.error);
      setSaved(content);
      setStatus("Saved.");
      const t = await wsTree(botId);
      if (!t.error) setEntries(t.entries);
    });
  }

  function create(kind: "file" | "skill" | "today") {
    let p: string | null = null;
    let body = "";
    if (kind === "today") {
      p = todayPath();
      body = `# ${p.slice(7, 17)}\n\n`;
    } else if (kind === "skill") {
      const slug = prompt("Skill slug (lowercase, dashes), e.g. deploy-site");
      if (!slug || !/^[a-z0-9][a-z0-9-]{1,40}$/.test(slug)) return;
      p = `skills/${slug}/SKILL.md`;
      body = SKILL_TEMPLATE(slug);
    } else {
      const name = prompt("New file path, e.g. notes/ideas.md");
      if (!name) return;
      p = name.replace(/^\/+/, "");
    }
    if (!p) return;
    if (entries.some((e) => e.path === p)) return open(p);
    start(async () => {
      const r = await wsWrite(botId, p!, body);
      if (r.error) return setStatus(r.error);
      const t = await wsTree(botId);
      if (!t.error) setEntries(t.entries);
      setPath(p);
      setContent(body);
      setSaved(body);
      setStatus(null);
    });
  }

  function remove() {
    if (!path || !confirm(`Delete ${path}?`)) return;
    start(async () => {
      const r = await wsDelete(botId, path);
      if (r.error) return setStatus(r.error);
      setPath(null);
      setContent("");
      setSaved("");
      const t = await wsTree(botId);
      if (!t.error) setEntries(t.entries);
    });
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="flex-1 min-h-0 grid md:grid-cols-[280px_1fr]">
      <aside className="border-b md:border-b-0 md:border-r border-line flex flex-col min-h-0">
        <div className="p-3 flex items-center gap-2 border-b border-line">
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter" className="input h-8 text-sm" aria-label="Filter files" />
          <button type="button" onClick={refresh} className="btn-ghost size-8 px-0!" aria-label="Refresh">
            <ArrowClockwiseIcon size={16} />
          </button>
        </div>
        <div className="px-3 py-2 flex flex-wrap gap-1.5 border-b border-line text-xs">
          <button type="button" onClick={() => create("today")} className="btn-secondary h-7 px-2 text-xs">
            <PlusIcon size={12} /> Today's note
          </button>
          <button type="button" onClick={() => create("skill")} className="btn-secondary h-7 px-2 text-xs">
            <PlusIcon size={12} /> Skill
          </button>
          <button type="button" onClick={() => create("file")} className="btn-secondary h-7 px-2 text-xs">
            <PlusIcon size={12} /> File
          </button>
        </div>
        <ul className="flex-1 overflow-y-auto py-2 text-sm">
          {entries.length === 0 && <li className="px-3 py-2 text-fg-muted">No files yet. The bot creates MEMORY.md and memory notes as it works.</li>}
          {filter
            ? files.map((f) => (
                <li key={f.path}>
                  <button type="button" onClick={() => open(f.path)} className={`w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-bg-sunk ${path === f.path ? "bg-bg-sunk font-medium" : ""}`}>
                    <FileTextIcon size={14} className="shrink-0 text-fg-faint" />
                    <span className="truncate font-mono text-xs">{f.path}</span>
                    <span className="ml-auto text-[10px] text-fg-faint">{fmtSize(f.size)}</span>
                  </button>
                </li>
              ))
            : tree.map((n) => <TreeRow key={n.path} node={n} depth={0} current={path} openDirs={openDirs} onToggle={toggleDir} onOpen={open} />)}
        </ul>
      </aside>

      <section className="flex flex-col min-h-0">
        {path ? (
          <>
            <div className="flex items-center gap-2 px-4 py-2 border-b border-line text-sm">
              <span className="font-mono text-xs truncate">{path}</span>
              {dirty && <span className="text-xs text-accent-ink">unsaved</span>}
              <span className="ml-auto text-xs text-fg-muted">{status}</span>
              <button type="button" onClick={save} disabled={pending || !dirty} className="btn-primary h-8">
                Save
              </button>
              <button type="button" onClick={remove} disabled={pending} className="btn-ghost size-8 px-0!" aria-label="Delete file">
                <TrashIcon size={16} />
              </button>
            </div>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              spellCheck={false}
              className="flex-1 w-full resize-none bg-bg px-4 py-3 font-mono text-[13px] leading-relaxed outline-none"
              aria-label="File content"
            />
          </>
        ) : (
          <div className="flex-1 grid place-items-center text-sm text-fg-muted px-6 text-center">
            <p>Pick a file on the left, or create today's memory note, a skill, or any file.</p>
          </div>
        )}
      </section>
    </div>
  );
}

function TreeRow({ node, depth, current, openDirs, onToggle, onOpen }: { node: TreeNode; depth: number; current: string | null; openDirs: Set<string>; onToggle: (d: string) => void; onOpen: (p: string) => void }) {
  const pad = { paddingLeft: `${12 + depth * 14}px` };
  if (node.dir) {
    const isOpen = openDirs.has(node.path);
    return (
      <li>
        <button type="button" onClick={() => onToggle(node.path)} className="w-full text-left pr-3 py-1.5 flex items-center gap-1.5 hover:bg-bg-sunk text-fg-muted" style={pad} aria-expanded={isOpen}>
          <CaretRightIcon size={10} weight="bold" className={`shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`} />
          {isOpen ? <FolderOpenIcon size={14} className="shrink-0 text-accent-ink" /> : <FolderIcon size={14} className="shrink-0 text-accent-ink" />}
          <span className="truncate font-mono text-xs">{node.name}/</span>
          <span className="ml-auto text-[10px] text-fg-faint">{node.children.length}</span>
        </button>
        {isOpen && (
          <ul>
            {node.children.map((c) => (
              <TreeRow key={c.path} node={c} depth={depth + 1} current={current} openDirs={openDirs} onToggle={onToggle} onOpen={onOpen} />
            ))}
          </ul>
        )}
      </li>
    );
  }
  return (
    <li>
      <button type="button" onClick={() => onOpen(node.path)} className={`w-full text-left pr-3 py-1.5 flex items-center gap-2 hover:bg-bg-sunk ${current === node.path ? "bg-bg-sunk font-medium" : ""}`} style={pad}>
        <FileTextIcon size={14} className="shrink-0 text-fg-faint" />
        <span className="truncate font-mono text-xs">{node.name}</span>
        <span className="ml-auto text-[10px] text-fg-faint">{fmtSize(node.size)}</span>
      </button>
    </li>
  );
}
