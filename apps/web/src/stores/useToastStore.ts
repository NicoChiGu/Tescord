import { create } from "zustand";
import { tGlobal, getErrorMessage } from "../i18n/index.js";
import type { DownloadProgress } from "@tescord/types";

export type ToastType = "info" | "success" | "error" | "warning";

export interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
  key?: string;
  params?: Record<string, string | number>;
  progress?: DownloadProgress;
}

export type ToastMessageInput =
  string | { key: string; params?: Record<string, any> } | any;

function resolveMessage(input: ToastMessageInput): string {
  if (!input) return "";
  if (typeof input === "string") {
    // 如果是 key 形式 (含冒号且命中字典)
    if (input.includes(":")) {
      const translated = tGlobal(input);
      if (translated && translated !== input) return translated;
    }
    return input;
  }
  if (typeof input === "object") {
    if ("key" in input && typeof input.key === "string") {
      return tGlobal(input.key, input.params);
    }
    return getErrorMessage(input);
  }
  return String(input);
}

interface ToastState {
  toasts: ToastItem[];
  showToast: (
    message: ToastMessageInput,
    type?: ToastType,
    duration?: number,
  ) => void;
  removeToast: (id: string) => void;
  updateToast: (
    id: string,
    key: string,
    params: Record<string, string | number>,
    type?: ToastType,
    progress?: DownloadProgress,
    duration?: number,
  ) => void;
}

const progressTimers = new Map<string, ReturnType<typeof setTimeout>>();

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  showToast: (
    messageInput: ToastMessageInput,
    type: ToastType = "info",
    duration = 3000,
  ) => {
    const id = Math.random().toString(36).substring(2, 9);
    const message = resolveMessage(messageInput);
    set((state) => ({
      toasts: [...state.toasts, { id, message, type }],
    }));
    setTimeout(() => {
      set((state) => ({
        toasts: state.toasts.filter((t) => t.id !== id),
      }));
    }, duration);
  },
  removeToast: (id: string) => {
    clearTimeout(progressTimers.get(id));
    progressTimers.delete(id);
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },
  updateToast: (id, key, params, type = "info", progress, duration) => {
    clearTimeout(progressTimers.get(id));
    progressTimers.delete(id);
    const item: ToastItem = { id, message: "", key, params, type, progress };
    set((state) => ({
      toasts: [...state.toasts.filter((toast) => toast.id !== id), item],
    }));
    if (duration)
      progressTimers.set(
        id,
        setTimeout(() => {
          set((state) => ({
            toasts: state.toasts.filter((toast) => toast.id !== id),
          }));
          progressTimers.delete(id);
        }, duration),
      );
  },
}));

export const toast = {
  info: (msg: ToastMessageInput, duration?: number) =>
    useToastStore.getState().showToast(msg, "info", duration),
  success: (msg: ToastMessageInput, duration?: number) =>
    useToastStore.getState().showToast(msg, "success", duration),
  error: (msg: ToastMessageInput, duration?: number) =>
    useToastStore.getState().showToast(msg, "error", duration),
};
