import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { API_BASE } from "../../config.js";
import { useAuthStore } from "../../stores/useAuthStore.js";
import { getErrorMessage } from "../../i18n/index.js";

export const ForcedPasswordChangeModal: React.FC = () => {
  const { t } = useTranslation(["modals", "common", "admin", "errors"]);
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
      setError(t("modals:forcedPasswordChange.passwordLengthError"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`${API_BASE}/api/auth/change-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          getErrorMessage(result) || t("modals:forcedPasswordChange.failed"),
        );
      }
      logout();
    } catch (cause: any) {
      setError(
        getErrorMessage(cause) || t("modals:forcedPasswordChange.failed"),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="forced-password-title"
    >
      <form
        onSubmit={submit}
        className="w-full max-w-md space-y-4 rounded-xl border border-[#3f4147] bg-[#313338] p-6 shadow-2xl"
      >
        <div>
          <h2
            id="forced-password-title"
            className="text-lg font-bold text-white"
          >
            {t("modals:forcedPasswordChange.title")}
          </h2>
          <p className="mt-1 text-sm text-discord-textMuted">
            {t("modals:forcedPasswordChange.subtitle")}
          </p>
        </div>
        {error && (
          <p className="rounded bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
            {error}
          </p>
        )}
        <input
          autoFocus
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          placeholder={t("modals:forcedPasswordChange.tempPasswordPlaceholder")}
          className="w-full rounded bg-[#1e1f22] p-3 text-white outline-none ring-discord-brand focus:ring-2"
        />
        <input
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder={t("modals:forcedPasswordChange.newPasswordPlaceholder")}
          className="w-full rounded bg-[#1e1f22] p-3 text-white outline-none ring-discord-brand focus:ring-2"
        />
        <input
          type="password"
          autoComplete="new-password"
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          placeholder={t(
            "modals:forcedPasswordChange.confirmPasswordPlaceholder",
          )}
          className="w-full rounded bg-[#1e1f22] p-3 text-white outline-none ring-discord-brand focus:ring-2"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={logout}
            className="rounded px-4 py-2 text-sm text-discord-textMuted hover:text-white"
          >
            {t("modals:forcedPasswordChange.logout")}
          </button>
          <button
            disabled={saving}
            className="rounded bg-discord-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving
              ? t("modals:forcedPasswordChange.submitting")
              : t("modals:forcedPasswordChange.submit")}
          </button>
        </div>
      </form>
    </div>
  );
};
