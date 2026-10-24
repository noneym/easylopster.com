import { PageHeader } from "@/components/app/page-header";
import { requireUser } from "@/lib/auth";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser();
  return (
    <>
      <PageHeader title="Settings" description="Your profile and sign-in details." />
      <div className="max-w-lg space-y-10">
        <SettingsForm name={user.name ?? ""} email={user.email} timezone={user.timezone} />
      </div>
    </>
  );
}
