import React from "react";
import { useTranslation } from "react-i18next";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "../ui/context-menu.js";
import { PlusCircle, Compass } from "lucide-react";

interface ServerListContextMenuProps {
  children: React.ReactNode;
  onCreateGuild: () => void;
  onJoinGuild: () => void;
}

export const ServerListContextMenu: React.FC<ServerListContextMenuProps> = ({
  children,
  onCreateGuild,
  onJoinGuild,
}) => {
  const { t } = useTranslation(["contextMenu", "common"]);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem
          onClick={onCreateGuild}
          className="hover:bg-discord-brand"
        >
          <div className="flex items-center space-x-2">
            <PlusCircle className="w-4 h-4 text-discord-textMuted" />
            <span>{t("contextMenu:server.createServer")}</span>
          </div>
        </ContextMenuItem>
        <ContextMenuItem
          onClick={onJoinGuild}
          className="hover:bg-discord-brand"
        >
          <div className="flex items-center space-x-2">
            <Compass className="w-4 h-4 text-discord-textMuted" />
            <span>{t("contextMenu:server.joinServer")}</span>
          </div>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
};
