import { NewAssignmentForm } from "@/components/NewAssignmentForm";

export default function NewAssignmentPage() {
  return (
    <>
      <h1>布置跟读</h1>
      <p className="muted">粘贴课文。系统按句号、问号、感叹号拆句。创建后可以改句子、合并、拆开，并逐句录标准音。</p>
      <NewAssignmentForm />
    </>
  );
}
