import { PageHeader } from "@/components/app/page-header";
import { requireUser } from "@/lib/auth";
import { NewNodeForm } from "./new-node-form";

export const metadata = { title: "New node" };

export default async function NewNodePage() {
  await requireUser();
  return (
    <>
      <PageHeader title="Connect a machine" description="Give it a name, then run the agent with the pairing code you get on the next screen." />
      <NewNodeForm />
    </>
  );
}
