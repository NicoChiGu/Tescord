import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChannelCategory, Guild } from "@tescord/types";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../ui/context-menu.js";
import { usePermissions } from "../../hooks/usePermissions.js";
import {
  Plus,
  Edit3,
  Trash2,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

interface CategoryContextMenuProps {
  category: ChannelCategory;
  guild?: Guild | null;
  children: React.ReactNode;
  onCreateChannel?: (category: ChannelCategory) => void;
  onEditCategory?: (category: ChannelCategory) => void;
  onDeleteCategory?: (category: ChannelCategory) => void;
  onToggleCollapse?: (category: ChannelCategory) => void;
  isCollapsed?: boolean;
}

export const CategoryContextMenu: React.FC<CategoryContextMenuProps> = ({
  category,
  guild,
  children,
  onCreateChannel,
  onEditCategory,
  onDeleteCategory,
  onToggleCollapse,
  isCollapsed,
}) => {
  const { t } = useTranslation(["contextMenu", "common"]);
  const { canManageChannels } = usePermissions(guild);
  const [copiedId, setCopiedId] = useState(false);

  const handleCopyId = async () => {
    try {
      await navigator.clipboard.writeText(category.id);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    } catch (e) {
      console.error("Failed to copy category id:", e);
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent
        className="w-52"
        data-testid={`category-context-menu-${category.id}`}
      >
        {canManageChannels && (
          <ContextMenuItem
            onClick={() => onCreateChannel?.(category)}
            className="hover:bg-discord-brand"
            data-testid="context-create-channel-btn"
          >
            <div className="flex items-center space-x-2">
              <Plus className="w-4 h-4 text-discord-textMuted" />
              <span>{t("contextMenu:category.createChannel")}</span>
            </div>
          </ContextMenuItem>
        )}

        <ContextMenuItem
          onClick={() => onToggleCollapse?.(category)}
          className="hover:bg-discord-brand"
        >
          <div className="flex items-center space-x-2">
            {isCollapsed ? (
              <ChevronRight className="w-4 h-4 text-discord-textMuted" />
            ) : (
              <ChevronDown className="w-4 h-4 text-discord-textMuted" />
            )}
            <span>
              {isCollapsed
                ? t("contextMenu:category.expand")
                : t("contextMenu:category.collapse")}
            </span>
          </div>
        </ContextMenuItem>

        <ContextMenuItem
          onClick={handleCopyId}
          className="hover:bg-discord-brand"
        >
          <div className="flex items-center space-x-2">
            {copiedId ? (
              <Check className="w-4 h-4 text-discord-green" />
            ) : (
              <Copy className="w-4 h-4 text-discord-textMuted" />
            )}
            <span>
              {copiedId ? t("common:copied") : t("contextMenu:category.copyId")}
            </span>
          </div>
        </ContextMenuItem>

        {canManageChannels && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              onClick={() => onEditCategory?.(category)}
              className="hover:bg-discord-brand"
              data-testid="context-edit-category-btn"
            >
              <div className="flex items-center space-x-2">
                <Edit3 className="w-4 h-4 text-discord-textMuted" />
                <span>{t("contextMenu:category.editCategory")}</span>
              </div>
            </ContextMenuItem>

            <ContextMenuItem
              onClick={() => onDeleteCategory?.(category)}
              className="text-red-400 hover:bg-red-500/20 focus:text-red-400"
              data-testid="context-delete-category-btn"
            >
              <div className="flex items-center space-x-2">
                <Trash2 className="w-4 h-4 text-red-400" />
                <span>{t("contextMenu:category.deleteCategory")}</span>
              </div>
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
};
