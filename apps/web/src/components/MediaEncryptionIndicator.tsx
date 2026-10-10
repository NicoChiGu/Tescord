import React, { useEffect, useState } from "react";
import { ShieldCheck, ShieldAlert, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { mediaEncryptionService } from "../services/mediaEncryption.js";
import { getErrorMessage } from "../i18n/index.js";

export function MediaEncryptionIndicator({
  showCounters = true,
  visuallyHidden = false,
}: {
  showCounters?: boolean;
  visuallyHidden?: boolean;
}) {
  const { t } = useTranslation("voice");
  const [state, setState] = useState(() => mediaEncryptionService.getState());
  useEffect(() => mediaEncryptionService.onState(setState), []);
  const phase =
    !state.contextId && state.phase !== "failed" ? "inactive" : state.phase;

  if (visuallyHidden) {
    return (
      <div
        data-testid="media-encryption-state"
        data-phase={phase}
        data-encrypted-frames={state.framesEncrypted}
        data-decrypted-frames={state.framesDecrypted}
        className="hidden"
        aria-hidden="true"
      />
    );
  }

  return (
    <div
      data-testid="media-encryption-state"
      data-phase={phase}
      data-encrypted-frames={state.framesEncrypted}
      data-decrypted-frames={state.framesDecrypted}
      role="status"
      aria-live="polite"
      className={`flex flex-col gap-1 min-w-0 text-xs ${state.phase === "failed" ? "text-red-300" : phase === "active" ? "text-emerald-400" : "text-discord-textMuted"}`}
    >
      <span className="flex items-center gap-1.5">
        {state.phase === "failed" ? (
          <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
        ) : phase === "negotiating" ? (
          <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" />
        ) : (
          <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
        )}
        {t(`mediaEncryption.${phase}`)}
      </span>
      {showCounters && (
        <span className="text-[11px] tabular-nums">
          {t("mediaEncryption.counts", {
            encrypted: state.framesEncrypted,
            decrypted: state.framesDecrypted,
          })}
        </span>
      )}
      {state.errorCode && (
        <span>{getErrorMessage({ code: state.errorCode })}</span>
      )}
    </div>
  );
}
