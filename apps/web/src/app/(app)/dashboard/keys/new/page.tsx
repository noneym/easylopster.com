import { PageHeader } from "@/components/app/page-header";
import { requireUser } from "@/lib/auth";
import { KeyForm } from "./key-form";

export const metadata = { title: "Add API key" };

export default async function NewKeyPage() {
  await requireUser();
  return (
    <>
      <PageHeader title="Add API key" description="We check the key with a free list-models call before saving. No tokens are spent." />
      <KeyForm />
    </>
  );
}
