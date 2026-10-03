"use client";

export function LogoutButton() {
  return (
    <button
      type="button"
      className="linkish"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        window.location.href = "/";
      }}
    >
      退出
    </button>
  );
}
