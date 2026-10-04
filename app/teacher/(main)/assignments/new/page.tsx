import { NewAssignmentForm } from "@/components/NewAssignmentForm";

export default function NewAssignmentPage() {
  return (
    <>
      <h1>布置跟读</h1>
      <p className="muted">粘贴课文。系统按句号、问号、感叹号拆句。创建后要上传或录制整段布置视频，也可以逐句录标准音。</p>
      <NewAssignmentForm />
    </>
  );
}
