import { create } from "zustand";
import { MaintenanceUpdatePayload } from "@tescord/types";

interface MaintenanceState {
  isMaintenance: boolean;
  announcement: string;
  triggeredAt?: string;
  estimatedEndTime?: string | null;
  setMaintenance: (payload: MaintenanceUpdatePayload) => void;
  clearMaintenance: () => void;
}

export const useMaintenanceStore = create<MaintenanceState>((set) => ({
  isMaintenance: false,
  announcement: "",
  triggeredAt: undefined,
  estimatedEndTime: null,

  setMaintenance: (payload: MaintenanceUpdatePayload) =>
    set({
      isMaintenance: payload.enabled,
      announcement: payload.announcement || "",
      triggeredAt: payload.triggeredAt,
      estimatedEndTime: payload.estimatedEndTime ?? null,
    }),

  clearMaintenance: () =>
    set({
      isMaintenance: false,
      announcement: "",
      triggeredAt: undefined,
      estimatedEndTime: null,
    }),
}));

if (typeof window !== "undefined") {
  (window as any).__TESCORD_MAINTENANCE_STORE__ = useMaintenanceStore;
}
