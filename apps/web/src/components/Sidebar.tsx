import { GuildIcon } from "./ui/GuildIcon.js";
import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Guild } from "@tescord/types";
import { Plus, Compass, ShieldAlert } from "lucide-react";
import { BrandLogo } from "./ui/BrandLogo.js";
import { resolveServerUrl } from "../config.js";
import { Tooltip } from "./ui/Tooltip.js";
import { ServerContextMenu } from "./context-menu/ServerContextMenu.js";
import { ServerListContextMenu } from "./context-menu/ServerListContextMenu.js";
import {
  DndContext,
  closestCenter,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
  DragOverlay,
  defaultDropAnimationSideEffects,
  DropAnimation,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface SidebarProps {
  guilds: Guild[];
  selectedGuildId: string | null;
  totalDmUnread?: number;
  guildUnreadMap?: Record<string, { hasUnread: boolean; mentionCount: number }>;
  isSuperAdmin?: boolean;
  onOpenAdminDashboard?: () => void;
  onSelectGuild: (guildId: string | null) => void;
  onOpenCreateGuild: () => void;
  onOpenJoinGuild: () => void;
  onOpenCreateChannel?: (guild: Guild) => void;
  onOpenServerSettings?: (guild: Guild) => void;
  onLeaveGuild?: (guild: Guild) => void;
  onMarkGuildAsRead?: (guild: Guild) => void;
  onReorderGuilds?: (reorderedGuilds: Guild[]) => void;
}

interface SortableServerItemProps {
  guild: Guild;
  isSelected: boolean;
  hasUnread?: boolean;
  mentionCount?: number;
  onSelectGuild: (guildId: string) => void;
  onOpenCreateChannel?: (guild: Guild) => void;
  onOpenServerSettings?: (guild: Guild) => void;
  onLeaveGuild?: (guild: Guild) => void;
  onMarkGuildAsRead?: (guild: Guild) => void;
}

const SortableServerItem: React.FC<SortableServerItemProps> = ({
  guild,
  isSelected,
  hasUnread = false,
  mentionCount = 0,
  onSelectGuild,
  onOpenCreateChannel,
  onOpenServerSettings,
  onLeaveGuild,
  onMarkGuildAsRead,
}) => {
  const {
    attributes: { role: _role, tabIndex: _tabIndex, ...sortableAttributes },
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: guild.id,
    data: { type: "guild", guild },
  });

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition: isDragging ? undefined : transition,
    opacity: isDragging ? 0.25 : 1,
    zIndex: isDragging ? 0 : "auto",
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="shrink-0 flex items-center justify-center w-full relative outline-none"
    >
      <ServerContextMenu
        guild={guild}
        onOpenCreateChannel={onOpenCreateChannel}
        onOpenServerSettings={onOpenServerSettings}
        onLeaveGuild={onLeaveGuild}
        onMarkAsRead={onMarkGuildAsRead}
      >
        <Tooltip content={guild.name} side="right">
          <button
            {...sortableAttributes}
            {...listeners}
            draggable={false}
            onDragStart={(e) => e.preventDefault()}
            onClick={() => onSelectGuild(guild.id)}
            className={`group relative flex items-center justify-center w-12 h-12 rounded-[24px] hover:rounded-[16px] transition-all duration-200 ease-out overflow-visible shrink-0 select-none active:scale-95 ${
              isDragging ? "opacity-25" : ""
            } ${isSelected ? "!rounded-[16px]" : ""}`}
            aria-label={guild.name}
          >
            <span
              className={`absolute left-0 w-1 bg-white rounded-r-full transition-all duration-200 ease-out ${
                isSelected
                  ? "h-10"
                  : hasUnread
                    ? "h-2 group-hover:h-5"
                    : "h-0 group-hover:h-5"
              }`}
            />
            <div className="w-12 h-12 rounded-[24px] group-hover:rounded-[16px] overflow-hidden transition-all duration-200 ease-out flex items-center justify-center">
              {guild.iconUrl ? (
                <GuildIcon
                  src={resolveServerUrl(guild.iconUrl)}
                  alt={guild.name}
                  draggable={false}
                  className="w-full h-full object-cover pointer-events-none select-none"
                />
              ) : (
                <div className="w-full h-full bg-discord-channelList text-discord-textHeader flex items-center justify-center font-semibold text-sm pointer-events-none select-none">
                  {guild.name.slice(0, 2).toUpperCase()}
                </div>
              )}
            </div>

            {/* 服务器提及未读数字 Badge */}
            {mentionCount > 0 && !isSelected && (
              <span
                className="absolute -bottom-1 -right-1 bg-[#f23f43] text-white text-[10px] font-bold px-1.5 min-w-[18px] h-[18px] rounded-full flex items-center justify-center border-2 border-discord-sidebar shadow-md pointer-events-none select-none z-10 animate-in zoom-in-75 duration-150"
                data-testid={`guild-mention-badge-${guild.id}`}
              >
                {mentionCount > 99 ? "99+" : mentionCount}
              </span>
            )}
          </button>
        </Tooltip>
      </ServerContextMenu>
    </div>
  );
};

export const Sidebar: React.FC<SidebarProps> = ({
  guilds,
  selectedGuildId,
  totalDmUnread = 0,
  guildUnreadMap = {},
  isSuperAdmin,
  onOpenAdminDashboard,
  onSelectGuild,
  onOpenCreateGuild,
  onOpenJoinGuild,
  onOpenCreateChannel,
  onOpenServerSettings,
  onLeaveGuild,
  onMarkGuildAsRead,
  onReorderGuilds,
}) => {
  const { t } = useTranslation("common");
  const [activeGuild, setActiveGuild] = useState<Guild | null>(null);

  // 拖拽传感器：PC 端与触屏端完全分隔
  // - PC 桌面端（MouseSensor）：鼠标左键移动 5px 立即启动拖拽，零延迟，完全不受长按影响；
  // - 触屏端（TouchSensor）：延时 1450ms 连续手势状态机（450ms 长按呼出菜单 + 1000ms 菜单展示缓冲，展示满 1 秒后滑动无缝启动拖拽重排）。
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 1450,
        tolerance: 10,
      },
    }),
  );

  // 拖拽激活时在全局禁止文本选择并显示抓取光标
  useEffect(() => {
    if (activeGuild) {
      document.body.style.userSelect = "none";
      document.body.style.cursor = "grabbing";
    } else {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    }
    return () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [activeGuild]);

  const dropAnimation: DropAnimation = {
    sideEffects: defaultDropAnimationSideEffects({
      styles: {
        active: {
          opacity: "0.4",
        },
      },
    }),
    duration: 180,
    easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)",
  };

  const handleDragStart = (event: DragStartEvent) => {
    const found = guilds.find((g) => g.id === event.active.id);
    if (found) {
      setActiveGuild(found);
    }
    // 严格与 PC 端分隔：
    // 通过 activatorEvent 精确判定是否由触屏手势触发。
    // 触屏端（touch）：派发 Escape 关闭已展示的长按菜单并提供触觉振动反馈；
    // PC 桌面端（mouse）：绝对不派发 Escape 键盘事件，避免触发 @dnd-kit 取消拖拽导致无法移动！
    const isTouch =
      (typeof TouchEvent !== "undefined" &&
        event.activatorEvent instanceof TouchEvent) ||
      (event.activatorEvent && "touches" in event.activatorEvent) ||
      (event.activatorEvent &&
        typeof event.activatorEvent.type === "string" &&
        event.activatorEvent.type.startsWith("touch"));

    if (isTouch) {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        try {
          navigator.vibrate(40);
        } catch {}
      }
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveGuild(null);

    if (!over || active.id === over.id) return;

    const oldIndex = guilds.findIndex((g) => g.id === active.id);
    const newIndex = guilds.findIndex((g) => g.id === over.id);

    if (oldIndex !== -1 && newIndex !== -1) {
      const reordered = arrayMove(guilds, oldIndex, newIndex);
      onReorderGuilds?.(reordered);
    }
  };

  const handleDragCancel = () => {
    setActiveGuild(null);
  };

  return (
    <ServerListContextMenu
      onCreateGuild={onOpenCreateGuild}
      onJoinGuild={onOpenJoinGuild}
    >
      <aside
        data-testid="servers-sidebar"
        className="w-[72px] h-full bg-discord-sidebar flex flex-col items-center py-3 space-y-2 select-none z-20 shrink-0"
      >
        {/* 私信 / 首页 */}
        <div className="relative shrink-0 flex items-center justify-center w-full">
          <Tooltip
            content={t("common:sidebar.home", "私信与主页")}
            side="right"
          >
            <button
              data-testid="home-nav-button"
              onClick={() => onSelectGuild(null)}
              className={`group relative flex items-center justify-center w-12 h-12 rounded-[24px] hover:rounded-[16px] transition-all duration-200 shrink-0 ${
                selectedGuildId === null
                  ? "bg-discord-brand text-white !rounded-[16px]"
                  : "bg-discord-channelList text-discord-textNormal hover:bg-discord-brand hover:text-white"
              }`}
            >
              <span
                className={`absolute left-0 w-1 bg-white rounded-r-full transition-all duration-200 ${
                  selectedGuildId === null ? "h-10" : "h-0 group-hover:h-5"
                }`}
              />
              <BrandLogo
                variant="symbol"
                className="w-7 h-7 transition-transform duration-200 group-hover:scale-105 active:scale-95"
              />

              {/* 右下角 Badge 展示私信未读数量，超过99展示 99+ */}
              {totalDmUnread > 0 && (
                <span
                  className="absolute -bottom-1 -right-1 bg-[#f23f43] text-white text-[10px] font-bold px-1.5 min-w-[18px] h-[18px] rounded-full flex items-center justify-center border-2 border-discord-sidebar shadow-md pointer-events-none select-none z-10 animate-in zoom-in-75 duration-150"
                  data-testid="dm-unread-badge"
                >
                  {totalDmUnread > 99 ? "99+" : totalDmUnread}
                </span>
              )}
            </button>
          </Tooltip>
        </div>

        {/* 超级管理员系统控制台 */}
        {isSuperAdmin && (
          <Tooltip
            content={t("common:sidebar.admin", "系统管理控制台 (超级管理员)")}
            side="right"
          >
            <button
              onClick={onOpenAdminDashboard}
              className="group relative flex items-center justify-center w-12 h-12 rounded-[24px] hover:rounded-[16px] bg-discord-channelList text-amber-400 hover:bg-amber-500 hover:text-white transition-all duration-200 shadow-md shrink-0"
              data-testid="admin-dashboard-btn"
            >
              <ShieldAlert className="w-6 h-6" />
            </button>
          </Tooltip>
        )}

        {/* 分隔线 */}
        <div className="w-8 h-[2px] bg-discord-channelList rounded-full my-1 shrink-0" />

        {/* 服务器列表 (支持拖拽调整排序，超出高度时纵向滚动，隐藏滚动条) */}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <SortableContext
            items={guilds.map((g) => g.id)}
            strategy={verticalListSortingStrategy}
          >
            <div
              data-testid="server-list-container"
              className="flex-1 w-full min-h-0 space-y-2 overflow-y-auto overflow-x-hidden flex flex-col items-center no-scrollbar [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden py-1"
            >
              {guilds.map((guild) => {
                const isSelected = selectedGuildId === guild.id;
                const unreadInfo = guildUnreadMap[guild.id];
                return (
                  <SortableServerItem
                    key={guild.id}
                    guild={guild}
                    isSelected={isSelected}
                    hasUnread={unreadInfo?.hasUnread || false}
                    mentionCount={unreadInfo?.mentionCount || 0}
                    onSelectGuild={onSelectGuild}
                    onOpenCreateChannel={onOpenCreateChannel}
                    onOpenServerSettings={onOpenServerSettings}
                    onLeaveGuild={onLeaveGuild}
                    onMarkGuildAsRead={onMarkGuildAsRead}
                  />
                );
              })}
            </div>
          </SortableContext>

          <DragOverlay dropAnimation={dropAnimation}>
            {activeGuild ? (
              <div className="w-12 h-12 rounded-[16px] overflow-hidden shadow-2xl bg-discord-channelList flex items-center justify-center ring-2 ring-discord-brand/80 scale-105 select-none pointer-events-none">
                {activeGuild.iconUrl ? (
                  <GuildIcon
                    src={resolveServerUrl(activeGuild.iconUrl)}
                    alt={activeGuild.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full text-discord-textHeader flex items-center justify-center font-semibold text-sm bg-discord-channelList">
                    {activeGuild.name.slice(0, 2).toUpperCase()}
                  </div>
                )}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>

        {/* 底部常驻操作区：创建新服务器与探索发现 */}
        <div className="flex flex-col items-center space-y-2 shrink-0 pt-1">
          {/* 添加服务器 */}
          <Tooltip
            content={t("common:sidebar.addServer", "添加服务器")}
            side="right"
          >
            <button
              className="group relative flex items-center justify-center w-12 h-12 rounded-[24px] hover:rounded-[16px] bg-discord-channelList text-discord-green hover:bg-discord-green hover:text-white transition-all duration-200 active:scale-95 shrink-0"
              onClick={onOpenCreateGuild}
            >
              <Plus className="w-6 h-6 transition-transform duration-200 ease-out group-hover:rotate-90" />
            </button>
          </Tooltip>

          {/* 加入公共社区 / 探索中心 */}
          <Tooltip
            content={t("common:sidebar.explore", "探索公开服务器")}
            side="right"
          >
            <button
              data-testid="open-discovery-btn"
              className="group relative flex items-center justify-center w-12 h-12 rounded-[24px] hover:rounded-[16px] bg-discord-channelList text-discord-green hover:bg-discord-green hover:text-white transition-all duration-200 active:scale-95 shrink-0"
              onClick={onOpenJoinGuild}
            >
              <Compass className="w-6 h-6 transition-transform duration-300 ease-out group-hover:rotate-45" />
            </button>
          </Tooltip>
        </div>
      </aside>
    </ServerListContextMenu>
  );
};
