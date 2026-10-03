export default function HomePage() {
  return (
    <>
      <div className="home-bar">
        <strong>跟读预批改</strong>
      </div>
      <main className="wrap">
        <h1>这一班的跟读，先让机器听一遍。</h1>
        <p className="muted">老师布置课文、逐句录标准音。学生用班级码跟读。老师只听有问题的作业。</p>
        <div className="big-links">
          <a className="big-link" href="/teacher">
            老师进入 <span>→</span>
          </a>
          <a className="big-link" href="/join">
            学生进入 <span>→</span>
          </a>
        </div>
      </main>
    </>
  );
}
