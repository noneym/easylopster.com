import { PageHeader } from "@/components/app/page-header";
import { requireUser } from "@/lib/auth";
import { NewNodeForm } from "./new-node-form";
import { NodeInstall } from "@/components/app/node-install";

export const metadata = { title: "New node" };

export default async function NewNodePage() {
  await requireUser();
  return (
    <>
      <PageHeader title="Connect a machine" description="Give it a name, then install the agent with the pairing code you get on the next screen." />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,28rem)_1fr] items-start">
        <NewNodeForm />
        <NodeInstall compact gateway={process.env.NEXT_PUBLIC_GATEWAY_WS_URL ?? process.env.GATEWAY_WS_URL} />
      </div>
    </>
  );
}
