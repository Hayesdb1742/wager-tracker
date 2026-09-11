import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { AccountClient } from "./AccountClient";

interface Props {
  searchParams: Promise<{ setup?: string }>;
}

export default async function AccountPage({ searchParams }: Props) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { setup } = await searchParams;

  return <AccountClient email={user.email ?? ""} setup={setup === "1"} />;
}
