import { redirect } from "next/navigation";
import { ReadAlong } from "@/components/ReadAlong";
import { LogoutButton } from "@/components/LogoutButton";
import { getStudentSession } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { canRecordSentence, getStudentAssignment } from "@/lib/submissions";

export default async function StudentAssignmentPage({ params }: { params: Promise<{ assignmentId: string }> }) {
  const { assignmentId } = await params;
  const id = Number(assignmentId);
  const student = await getStudentSession();
  if (!student) redirect(`/join?next=/s/${assignmentId}`);
  let view;
  try {
    view = await getStudentAssignment(id, student.studentId, student.classId);
  } catch (error) {
    if (error instanceof AppError) {
      return (
        <main className="wrap">
          <p className="error">{error.message}</p>
          <a href="/join">返回班级</a>
        </main>
      );
    }
    throw error;
  }
  const recordable = view.sentences.filter((sentence) => canRecordSentence(view, sentence.id)).map((sentence) => sentence.id);
  return (
    <>
      <header className="topbar">
        <a href="/join">{view.title}</a>
        <LogoutButton />
      </header>
      <main className="wrap">
        <h1>{view.title}</h1>
        <ReadAlong view={view} recordable={recordable} />
      </main>
    </>
  );
}
