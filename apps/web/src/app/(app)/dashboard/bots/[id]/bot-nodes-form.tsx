import Link from "next/link";
import { setBotNodes } from "../../nodes/actions";

type NodeRow = { id: string; name: string; status: string; online: boolean; caps: string[] };

export function BotNodesForm({ botId, nodes, linked }: { botId: string; nodes: NodeRow[]; linked: string[] }) {
  const action = setBotNodes.bind(null, botId);
  return (
    <form action={action} className="card p-6">
      <h2 className="font-semibold tracking-tight">Nodes</h2>
      <p className="text-sm text-fg-muted mt-0.5">
        Your machines this bot may reach. Tools appear as node_&lt;name&gt;_… when the node is online.{" "}
        <Link href="/dashboard/nodes" className="underline underline-offset-4 text-fg">
          Manage nodes
        </Link>
      </p>
      {nodes.length === 0 ? (
        <p className="mt-4 text-sm text-fg-muted">No nodes connected yet.</p>
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {nodes.map((n) => (
            <li key={n.id} className="py-3 flex items-center gap-3">
              <input type="checkbox" id={`node-${n.id}`} name={`node:${n.id}`} defaultChecked={linked.includes(n.id)} className="size-4 accent-[var(--accent)]" />
              <label htmlFor={`node-${n.id}`} className="flex-1 text-sm">
                <span className="font-medium">{n.name}</span>{" "}
                <span className="text-fg-muted">
                  · {n.online ? "online" : n.status}
                  {n.caps.length ? ` · ${n.caps.join(", ")}` : ""}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {nodes.length > 0 && (
        <button type="submit" className="btn-primary mt-4">
          Save node settings
        </button>
      )}
    </form>
  );
}
