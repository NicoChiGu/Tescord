import { create } from "zustand";
import React from "react";

export type DialogVariant = "danger" | "warning" | "info";

export interface ConfirmDialogOptions {
  title: string;
  description?: React.ReactNode | string;
  confirmText?: string;
  cancelText?: string;
  variant?: DialogVariant;
  /** 是否需要输入 4 位随机数字安全码 */
  requireSecurityCode?: boolean;
  dangerWarning?: string;
}

export interface PromptDialogOptions {
  title: string;
  description?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmText?: string;
  cancelText?: string;
  required?: boolean;
  maxLength?: number;
}

interface DialogState {
  isOpen: boolean;
  type: "confirm" | "prompt" | null;
  confirmOptions: ConfirmDialogOptions | null;
  promptOptions: PromptDialogOptions | null;
  resolveConfirm: ((value: boolean) => void) | null;
  resolvePrompt: ((value: string | null) => void) | null;
  confirm: (options: ConfirmDialogOptions) => Promise<boolean>;
  prompt: (options: PromptDialogOptions) => Promise<string | null>;
  close: () => void;
  handleConfirmResult: (result: boolean) => void;
  handlePromptResult: (result: string | null) => void;
}

export const useDialogStore = create<DialogState>((set, get) => ({
  isOpen: false,
  type: null,
  confirmOptions: null,
  promptOptions: null,
  resolveConfirm: null,
  resolvePrompt: null,

  confirm: (options: ConfirmDialogOptions) => {
    const state = get();
    if (state.resolveConfirm) state.resolveConfirm(false);
    if (state.resolvePrompt) state.resolvePrompt(null);

    return new Promise<boolean>((resolve) => {
      set({
        isOpen: true,
        type: "confirm",
        confirmOptions: options,
        promptOptions: null,
        resolveConfirm: resolve,
        resolvePrompt: null,
      });
    });
  },

  prompt: (options: PromptDialogOptions) => {
    const state = get();
    if (state.resolveConfirm) state.resolveConfirm(false);
    if (state.resolvePrompt) state.resolvePrompt(null);

    return new Promise<string | null>((resolve) => {
      set({
        isOpen: true,
        type: "prompt",
        confirmOptions: null,
        promptOptions: options,
        resolveConfirm: null,
        resolvePrompt: resolve,
      });
    });
  },

  close: () => {
    const state = get();
    if (state.resolveConfirm) state.resolveConfirm(false);
    if (state.resolvePrompt) state.resolvePrompt(null);
    set({
      isOpen: false,
      type: null,
      confirmOptions: null,
      promptOptions: null,
      resolveConfirm: null,
      resolvePrompt: null,
    });
  },

  handleConfirmResult: (result: boolean) => {
    const { resolveConfirm } = get();
    if (resolveConfirm) resolveConfirm(result);
    set({
      isOpen: false,
      type: null,
      confirmOptions: null,
      resolveConfirm: null,
    });
  },

  handlePromptResult: (result: string | null) => {
    const { resolvePrompt } = get();
    if (resolvePrompt) resolvePrompt(result);
    set({
      isOpen: false,
      type: null,
      promptOptions: null,
      resolvePrompt: null,
    });
  },
}));

export const dialog = {
  confirm: (options: ConfirmDialogOptions) =>
    useDialogStore.getState().confirm(options),
  prompt: (options: PromptDialogOptions) =>
    useDialogStore.getState().prompt(options),
  close: () => useDialogStore.getState().close(),
};
