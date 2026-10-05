import { JoinForm } from "@/components/JoinForm";
import { LogoutButton } from "@/components/LogoutButton";
import { getStudentSession } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { listOpenAssignments } from "@/lib/submissions";

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; code?: string }>;
}) {
  const params = await searchParams;
  const next = params.next?.startsWith("/") ? params.next : undefined;
  const student = await getStudentSession();
  return (
    <>
      <header className="topbar">
        <a href="/">跟读预批改</a>
        {student ? <LogoutButton /> : null}
      </header>
      <main className="wrap">
        <h1>学生进入</h1>
        {student ? (
          <>
            <p className="muted">你已经在这个班里。要换姓名，先退出再进入。</p>
            <AssignmentList classId={student.classId} />
          </>
        ) : (
          <>
            <p className="muted">输入老师给你的班级码和你的姓名。</p>
            <JoinForm next={next} initialCode={params.code} />
          </>
        )}
      </main>
    </>
  );
}

async function AssignmentList({ classId }: { classId: number }) {
  let assignments;
  try {
    assignments = await listOpenAssignments(classId);
  } catch (error) {
    if (error instanceof AppError) return <p className="error">{error.message}</p>;
    throw error;
  }
  if (assignments.length === 0) return <p className="muted">这个班还没有已发布的作业。</p>;
  return (
    <div className="stack">
      {assignments.map((assignment) => (
        <a key={assignment.id} className="card list-card" href={`/s/${assignment.id}`}>
          <strong>{assignment.title}</strong>
          <span>去跟读</span>
        </a>
      ))}
    </div>
  );
}
