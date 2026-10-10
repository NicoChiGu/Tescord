import { useState, useEffect, useCallback } from "react";
import type {
  KeybindConfig,
  KeybindAction,
  KeybindConflictResult,
} from "@tescord/types";

const STORAGE_KEY = "tescord_keybinds_config";

export const DEFAULT_KEYBINDS: KeybindConfig[] = [
  { id: "TOGGLE_MUTE", shortcut: "Control+Shift+KeyM", enabled: true },
  { id: "TOGGLE_DEAFEN", shortcut: "Control+Shift+KeyD", enabled: true },
  { id: "SCREEN_CAPTURE", shortcut: "Control+Shift+KeyS", enabled: true },
];

export function normalizeShortcut(shortcut: string): string {
  if (!shortcut || typeof shortcut !== "string") return "";
  const parts = shortcut.split("+").map((p) => p.trim());
  const modifiers = new Set<string>();
  let primaryKey = "";

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (
      lower === "ctrl" ||
      lower === "control" ||
      lower === "controlleft" ||
      lower === "controlright"
    ) {
      modifiers.add("Control");
    } else if (
      lower === "alt" ||
      lower === "altleft" ||
      lower === "altright"
    ) {
      modifiers.add("Alt");
    } else if (
      lower === "shift" ||
      lower === "shiftleft" ||
      lower === "shiftright"
    ) {
      modifiers.add("Shift");
    } else if (
      lower === "meta" ||
      lower === "cmd" ||
      lower === "command" ||
      lower === "metaleft" ||
      lower === "metaright"
    ) {
      modifiers.add("Meta");
    } else {
      primaryKey = part;
    }
  }

  const orderedMods: string[] = [];
  if (modifiers.has("Control")) orderedMods.push("Control");
  if (modifiers.has("Meta")) orderedMods.push("Meta");
  if (modifiers.has("Alt")) orderedMods.push("Alt");
  if (modifiers.has("Shift")) orderedMods.push("Shift");

  if (primaryKey) {
    orderedMods.push(primaryKey);
  }
  return orderedMods.join("+");
}

export function formatShortcutDisplay(shortcut: string): string {
  if (!shortcut) return "";
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPod|iPhone|iPad/.test(navigator.platform);

  return shortcut
    .split("+")
    .map((part) => {
      if (part === "Control") return isMac ? "Ctrl" : "Ctrl";
      if (part === "Meta") return isMac ? "⌘ Cmd" : "Win";
      if (part === "Alt") return isMac ? "⌥ Opt" : "Alt";
      if (part === "Shift") return isMac ? "⇧ Shift" : "Shift";
      if (part.startsWith("Key") && part.length === 4) {
        return part.slice(3).toUpperCase();
      }
      if (part.startsWith("Digit") && part.length === 6) {
        return part.slice(5);
      }
      return part.toUpperCase();
    })
    .join(" + ");
}

export function useKeybinds() {
  const [keybinds, setKeybinds] = useState<KeybindConfig[]>(() => {
    if (typeof window === "undefined") return DEFAULT_KEYBINDS;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return DEFAULT_KEYBINDS.map((def) => {
            const found = parsed.find((p) => p.id === def.id);
            return found ? { ...def, ...found } : def;
          });
        }
      }
    } catch {}
    return DEFAULT_KEYBINDS;
  });

  const syncToElectron = useCallback((configs: KeybindConfig[]) => {
    if (typeof window !== "undefined" && window.electronAPI?.registerKeybinds) {
      return window.electronAPI.registerKeybinds(configs);
    }
    return Promise.resolve({ success: true, conflicts: [] });
  }, []);

  useEffect(() => {
    syncToElectron(keybinds);
  }, [keybinds, syncToElectron]);

  const checkInternalConflict = useCallback(
    (actionId: KeybindAction, newShortcut: string): KeybindConflictResult => {
      const normNew = normalizeShortcut(newShortcut);
      if (!normNew) return { conflict: false };

      for (const item of keybinds) {
        if (item.id === actionId) continue;
        if (!item.enabled) continue;
        const normExisting = normalizeShortcut(item.shortcut);
        if (normExisting === normNew) {
          return {
            conflict: true,
            type: "INTERNAL_CONFLICT",
            conflictingAction: item.id,
            shortcut: newShortcut,
          };
        }
      }
      return { conflict: false };
    },
    [keybinds],
  );

  const updateKeybind = useCallback(
    async (
      actionId: KeybindAction,
      updates: Partial<KeybindConfig>,
    ): Promise<KeybindConflictResult> => {
      const current = keybinds.find((k) => k.id === actionId);
      if (!current) return { conflict: false };

      const targetShortcut = updates.shortcut ?? current.shortcut;
      const targetEnabled = updates.enabled ?? current.enabled;

      if (targetEnabled && targetShortcut) {
        const internalCheck = checkInternalConflict(actionId, targetShortcut);
        if (internalCheck.conflict) {
          return internalCheck;
        }
      }

      const nextKeybinds = keybinds.map((k) =>
        k.id === actionId ? { ...k, ...updates } : k,
      );

      if (typeof window !== "undefined" && window.electronAPI?.registerKeybinds) {
        const res = await window.electronAPI.registerKeybinds(nextKeybinds);
        if (!res.success && res.conflicts?.length > 0) {
          const matched = res.conflicts.find((c) => c.id === actionId);
          if (matched) {
            return {
              conflict: true,
              type: "SYSTEM_OCCUPIED",
              conflictingAction: actionId,
              shortcut: targetShortcut,
            };
          }
        }
      }

      setKeybinds(nextKeybinds);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(nextKeybinds));
      } catch {}

      return { conflict: false };
    },
    [keybinds, checkInternalConflict],
  );

  const resetKeybinds = useCallback(() => {
    setKeybinds(DEFAULT_KEYBINDS);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_KEYBINDS));
    } catch {}
    syncToElectron(DEFAULT_KEYBINDS);
  }, [syncToElectron]);

  return {
    keybinds,
    updateKeybind,
    resetKeybinds,
    checkInternalConflict,
  };
}
