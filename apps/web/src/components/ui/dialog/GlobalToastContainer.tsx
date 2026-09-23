import React from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { useToastStore, ToastType } from "../../../stores/useToastStore";

export const GlobalToastContainer: React.FC = () => {
  const { toasts, removeToast } = useToastStore();

  if (toasts.length === 0) return null;

  const getIcon = (type: ToastType) => {
    switch (type) {
      case "success":
        return <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />;
      case "error":
        return <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />;
      case "info":
      default:
        return <Info className="w-4 h-4 text-discord-brand shrink-0" />;
    }
  };

  const getBorderColor = (type: ToastType) => {
    switch (type) {
      case "success":
        return "border-emerald-500/30";
      case "error":
        return "border-rose-500/30";
      case "info":
      default:
        return "border-discord-brand/30";
    }
  };

  return (
    <div className="fixed top-5 right-5 z-[110] flex flex-col gap-2 max-w-sm pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl bg-[#2b2d31]/95 text-white shadow-xl border ${getBorderColor(
            toast.type,
          )} backdrop-blur-md animate-in slide-in-from-top-2 fade-in duration-200`}
        >
          {getIcon(toast.type)}
          <span className="text-sm font-medium leading-snug flex-1">
            {toast.message}
          </span>
          <button
            type="button"
            onClick={() => removeToast(toast.id)}
            className="text-gray-400 hover:text-white p-0.5 rounded transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
};
