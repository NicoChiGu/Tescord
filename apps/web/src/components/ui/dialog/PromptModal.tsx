import React, { useState } from "react";
import { MessageSquare } from "lucide-react";
import { BaseModal } from "./BaseModal";
import { PromptDialogOptions } from "../../../stores/useDialogStore";

interface PromptModalProps {
  options: PromptDialogOptions;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

export const PromptModal: React.FC<PromptModalProps> = ({
  options,
  onSubmit,
  onCancel,
}) => {
  const {
    title,
    description,
    placeholder = "请输入...",
    defaultValue = "",
    confirmText = "确定",
    cancelText = "取消",
    required = false,
    maxLength = 200,
  } = options;

  const [value, setValue] = useState(defaultValue);
  const isValid = !required || value.trim().length > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isValid) {
      onSubmit(value.trim());
    }
  };

  return (
    <BaseModal
      isOpen={true}
      onClose={onCancel}
      title={title}
      icon={<MessageSquare className="w-5 h-5 text-discord-brand" />}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {description && (
          <p className="text-sm text-gray-300 leading-relaxed">{description}</p>
        )}

        <div className="space-y-1.5">
          <input
            type="text"
            data-testid="dialog-prompt-input"
            value={value}
            maxLength={maxLength}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            className="w-full bg-[#1e1f22] border border-white/10 rounded-lg px-3.5 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-discord-brand transition-colors"
            autoFocus
          />
          {maxLength && (
            <div className="text-right text-xs text-gray-500">
              {value.length}/{maxLength}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            data-testid="dialog-prompt-cancel-btn"
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-gray-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
          >
            {cancelText}
          </button>
          <button
            type="submit"
            data-testid="dialog-prompt-submit-btn"
            disabled={!isValid}
            className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all ${
              isValid
                ? "bg-discord-brand hover:bg-discord-brand-hover text-white shadow-lg shadow-indigo-900/30"
                : "bg-gray-700/60 text-gray-500 cursor-not-allowed border border-white/5"
            }`}
          >
            {confirmText}
          </button>
        </div>
      </form>
    </BaseModal>
  );
};
