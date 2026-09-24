import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { ShieldAlert, Power, Sliders, Loader2 } from "lucide-react";
import { useMaintenanceStore } from "../../stores/useMaintenanceStore.js";
import { useAuthStore } from "../../stores/useAuthStore.js";
import { API_BASE } from "../../config.js";

interface MaintenanceAdminBannerProps {
  onOpenAdminModal?: () => void;
}

export const MaintenanceAdminBanner: React.FC<MaintenanceAdminBannerProps> = ({
  onOpenAdminModal,
}) => {
  const { t } = useTranslation(["common"]);
  const { announcement, clearMaintenance } = useMaintenanceStore();
  const { getAuthHeaders } = useAuthStore();
  const [isDisabling, setIsDisabling] = useState(false);

  const handleDisableMaintenance = async () => {
    if (isDisabling) return;
    setIsDisabling(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/settings`, {
        method: "PATCH",
        headers: {
          ...getAuthHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          maintenanceMode: false,
        }),
      });
      if (res.ok) {
        clearMaintenance();
      } else {
        console.error("Failed to disable maintenance mode:", await res.text());
      }
    } catch (e) {
      console.error("Error disabling maintenance mode:", e);
    } finally {
      setIsDisabling(false);
    }
  };

  return (
    <div
      data-testid="maintenance-admin-banner"
      className="relative z-50 flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-amber-600 via-amber-500 to-orange-600 px-4 py-2 text-xs font-medium text-black shadow-lg"
    >
      <div className="flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-black/20 text-black">
          <ShieldAlert className="h-3.5 w-3.5" />
        </span>
        <span className="font-bold">
          {t("common:maintenance.adminBadge")}
        </span>
        <span className="hidden sm:inline opacity-90">
          {t("common:maintenance.adminDesc")}
        </span>
        {announcement && (
          <span className="hidden md:inline rounded bg-black/15 px-2 py-0.5 text-[11px] font-normal">
            {t("common:maintenance.announcement")}{announcement}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {onOpenAdminModal && (
          <button
            onClick={onOpenAdminModal}
            className="flex items-center gap-1 rounded bg-black/20 px-2.5 py-1 text-black font-semibold hover:bg-black/30 transition cursor-pointer"
          >
            <Sliders className="h-3 w-3" />
            {t("common:maintenance.settings")}
          </button>
        )}
        <button
          onClick={handleDisableMaintenance}
          disabled={isDisabling}
          className="flex items-center gap-1 rounded bg-black px-3 py-1 font-semibold text-amber-400 hover:bg-black/80 active:scale-95 transition disabled:opacity-50 cursor-pointer shadow"
        >
          {isDisabling ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Power className="h-3 w-3" />
          )}
          {t("common:maintenance.disableBtn")}
        </button>
      </div>
    </div>
  );
};
