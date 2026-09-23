import React from "react";
import { useDialogStore } from "../../../stores/useDialogStore";
import { ConfirmModal } from "./ConfirmModal";
import { PromptModal } from "./PromptModal";

export const GlobalDialogContainer: React.FC = () => {
  const {
    isOpen,
    type,
    confirmOptions,
    promptOptions,
    handleConfirmResult,
    handlePromptResult,
  } = useDialogStore();

  if (!isOpen) return null;

  if (type === "confirm" && confirmOptions) {
    return (
      <ConfirmModal
        options={confirmOptions}
        onConfirm={() => handleConfirmResult(true)}
        onCancel={() => handleConfirmResult(false)}
      />
    );
  }

  if (type === "prompt" && promptOptions) {
    return (
      <PromptModal
        options={promptOptions}
        onSubmit={(value) => handlePromptResult(value)}
        onCancel={() => handlePromptResult(null)}
      />
    );
  }

  return null;
};
