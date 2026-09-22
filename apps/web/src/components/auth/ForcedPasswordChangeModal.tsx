import React, { useState } from "react";
import { API_BASE } from "../../config.js";
import { useAuthStore } from "../../stores/useAuthStore.js";

export const ForcedPasswordChangeModal: React.FC = () => {
  const { user, token, logout } = useAuthStore();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  if (!user?.mustChangePassword) return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (newPassword.length < 10 || newPassword !== confirmation) {
      setError("新密码至少 10 位，且两次输入必须一致");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`${API_BASE}/api/auth/change-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "修改密码失败");
      logout();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "修改密码失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4" role="dialog" aria-modal="true" aria-labelledby="forced-password-title">
      <form onSubmit={submit} className="w-full max-w-md space-y-4 rounded-xl border border-[#3f4147] bg-[#313338] p-6 shadow-2xl">
        <div>
          <h2 id="forced-password-title" className="text-lg font-bold text-white">设置新的登录密码</h2>
          <p className="mt-1 text-sm text-discord-textMuted">管理员生成的临时密码只能用于本次登录。修改后全部设备需要重新登录。</p>
        </div>
        {error && <p className="rounded bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>}
        <input autoFocus type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="临时密码" className="w-full rounded bg-[#1e1f22] p-3 text-white outline-none ring-discord-brand focus:ring-2" />
        <input type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="新密码（至少 10 位）" className="w-full rounded bg-[#1e1f22] p-3 text-white outline-none ring-discord-brand focus:ring-2" />
        <input type="password" autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} placeholder="再次输入新密码" className="w-full rounded bg-[#1e1f22] p-3 text-white outline-none ring-discord-brand focus:ring-2" />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={logout} className="rounded px-4 py-2 text-sm text-discord-textMuted hover:text-white">退出登录</button>
          <button disabled={saving} className="rounded bg-discord-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? "正在保存…" : "修改并重新登录"}</button>
        </div>
      </form>
    </div>
  );
};
