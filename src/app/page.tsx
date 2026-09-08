import { redirect } from "next/navigation";

// The pool has no separate landing page -- /picks is the members' home.
// Anonymous visitors never get here: the proxy sends them to /login first,
// which is why this only ever showed the scaffold to signed-in users.
export default function Home() {
  redirect("/picks");
}
