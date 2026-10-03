import { redirect } from "next/navigation";
import { LogoutButton } from "@/components/LogoutButton";
import { getTeacherSession } from "@/lib/auth";

export default async function TeacherLayout({ children }: { children: React.ReactNode }) {
  const session = await getTeacherSession();
  if (!session) redirect("/teacher/login");
  return (
    <>
      <header className="topbar">
        <a href="/teacher">跟读预批改</a>
        <LogoutButton />
      </header>
      <main className="wrap">{children}</main>
    </>
  );
}
