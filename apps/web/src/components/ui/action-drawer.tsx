import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import { Drawer } from "vaul";
import { ChevronLeft, LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

export interface DrawerSubView {
  title: string;
  content: React.ReactNode;
}

interface ActionDrawerContextValue {
  pushView: (view: DrawerSubView) => void;
  popView: () => void;
  resetView: () => void;
  close: () => void;
}

const ActionDrawerContext = createContext<ActionDrawerContextValue | null>(
  null,
);

export const useActionDrawer = () => {
  const context = useContext(ActionDrawerContext);
  if (!context) {
    throw new Error("useActionDrawer must be used within an ActionDrawer");
  }
  return context;
};

export interface ActionDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  showDragHandle?: boolean;
  headerContent?: React.ReactNode;
  "data-testid"?: string;
}

export const ActionDrawer: React.FC<ActionDrawerProps> = ({
  isOpen,
  onClose,
  title,
  description,
  children,
  className = "",
  showDragHandle = true,
  headerContent,
  "data-testid": testId = "action-drawer",
}) => {
  const { t } = useTranslation(["contextMenu", "common"]);
  const resolvedTitle = title || t("contextMenu:messageActions", "操作菜单");
  const resolvedDesc =
    description || t("contextMenu:messageActions", "上下文快捷操作选项");
  const [viewStack, setViewStack] = useState<DrawerSubView[]>([]);

  // 触觉震动与收起输入法软键盘
  useEffect(() => {
    if (isOpen) {
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        try {
          navigator.vibrate(40);
        } catch {
          // ignore unsupported platforms
        }
      }
      if (typeof document !== "undefined" && document.activeElement) {
        (document.activeElement as HTMLElement)?.blur?.();
      }
    } else {
      setViewStack([]);
    }
  }, [isOpen]);

  const pushView = useCallback((view: DrawerSubView) => {
    setViewStack((prev) => [...prev, view]);
  }, []);

  const popView = useCallback(() => {
    setViewStack((prev) => (prev.length > 0 ? prev.slice(0, -1) : prev));
  }, []);

  const resetView = useCallback(() => {
    setViewStack([]);
  }, []);

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      onClose();
    }
  };

  const currentSubView =
    viewStack.length > 0 ? viewStack[viewStack.length - 1] : null;

  return (
    <ActionDrawerContext.Provider
      value={{
        pushView,
        popView,
        resetView,
        close: onClose,
      }}
    >
      <Drawer.Root
        open={isOpen}
        onOpenChange={handleOpenChange}
        shouldScaleBackground={false}
        dismissible={true}
      >
        <Drawer.Portal>
          {/* 背景半透明黑色蒙层 */}
          <Drawer.Overlay
            data-testid="action-drawer-overlay"
            className="fixed inset-0 z-[9990] bg-black/60 backdrop-blur-sm transition-opacity"
          />

          {/* 底部抽屉面板主体 */}
          <Drawer.Content
            data-testid={testId}
            className={`fixed bottom-0 left-0 right-0 z-[9991] max-h-[85vh] bg-[#2b2d31] rounded-t-2xl border-t border-[#3f4147] shadow-2xl flex flex-col outline-none focus:outline-none focus-visible:outline-none text-[#dbdee1] ${className}`}
          >
            {/* 访问性必须的标题与描述 */}
            <Drawer.Title className="sr-only">{resolvedTitle}</Drawer.Title>
            <Drawer.Description className="sr-only">
              {resolvedDesc}
            </Drawer.Description>

            {/* Discord 风格顶部把手 */}
            {showDragHandle && (
              <div
                data-testid="drawer-drag-handle"
                className="flex items-center justify-center pt-2.5 pb-1 flex-shrink-0 cursor-grab active:cursor-grabbing"
              >
                <div className="w-10 h-1 bg-[#4e5058] rounded-full" />
              </div>
            )}

            {/* 可选顶部附加内容 (如快捷表情栏) */}
            {!currentSubView && headerContent && (
              <div className="px-4 pt-1 pb-2 flex-shrink-0">
                {headerContent}
              </div>
            )}

            {/* 抽屉内部下钻导航栏 (若处于二级子视图) */}
            {currentSubView && (
              <div className="flex items-center px-4 py-2 border-b border-[#35373c] flex-shrink-0 animate-fade-in">
                <button
                  type="button"
                  data-testid="drawer-back-button"
                  onClick={popView}
                  className="flex items-center text-sm font-medium text-discord-textMuted hover:text-white active:scale-95 transition"
                >
                  <ChevronLeft className="w-5 h-5 mr-1 text-discord-textMuted" />
                  <span>{currentSubView.title}</span>
                </button>
              </div>
            )}

            {/* 抽屉滚动内容区域 */}
            <div className="overflow-y-auto px-4 pt-1 pb-[calc(1.25rem+env(safe-area-inset-bottom))] flex flex-col space-y-2 custom-scrollbar">
              {currentSubView ? currentSubView.content : children}
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </ActionDrawerContext.Provider>
  );
};

export interface DrawerItemProps {
  icon?: LucideIcon | React.ComponentType<{ className?: string }>;
  label: React.ReactNode;
  description?: React.ReactNode;
  rightElement?: React.ReactNode;
  onClick?: () => void;
  variant?: "default" | "danger" | "brand";
  isDestructive?: boolean;
  confirmLabel?: string;
  disabled?: boolean;
  className?: string;
  "data-testid"?: string;
}

/**
 * 移动端抽屉标准操作条目，支持高频点击与危险操作原地变红二次确认
 */
export const DrawerItem: React.FC<DrawerItemProps> = ({
  icon: Icon,
  label,
  description,
  rightElement,
  onClick,
  variant = "default",
  isDestructive = false,
  confirmLabel,
  disabled = false,
  className = "",
  "data-testid": itemTestId,
}) => {
  const { t } = useTranslation(["contextMenu", "common"]);
  const [isConfirming, setIsConfirming] = useState(false);
  const { close } = useActionDrawer();

  useEffect(() => {
    if (isConfirming) {
      const timer = setTimeout(() => setIsConfirming(false), 3500);
      return () => clearTimeout(timer);
    }
  }, [isConfirming]);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled) return;

    if (isDestructive && !isConfirming) {
      setIsConfirming(true);
      return;
    }

    setIsConfirming(false);
    onClick?.();
  };

  const isDanger = variant === "danger" || isDestructive;

  return (
    <button
      type="button"
      disabled={disabled}
      data-testid={itemTestId}
      onClick={handleClick}
      className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl transition text-left select-none ${
        disabled
          ? "opacity-50 cursor-not-allowed"
          : isConfirming
            ? "bg-discord-danger text-white font-semibold"
            : isDanger
              ? "text-discord-danger hover:bg-discord-danger/10 active:bg-discord-danger active:text-white"
              : "text-[#dbdee1] hover:bg-[#35373c] active:bg-[#35373c] active:text-white"
      } ${className}`}
    >
      <div className="flex items-center space-x-3 min-w-0">
        {Icon && (
          <Icon
            className={`w-5 h-5 flex-shrink-0 ${
              isConfirming
                ? "text-white"
                : isDanger
                  ? "text-discord-danger"
                  : "text-discord-textMuted"
            }`}
          />
        )}
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-medium truncate">
            {isConfirming
              ? confirmLabel || t("contextMenu:confirmDelete", "确认执行？")
              : label}
          </span>
          {description && !isConfirming && (
            <span className="text-[11px] text-discord-textMuted truncate">
              {description}
            </span>
          )}
        </div>
      </div>
      {rightElement && !isConfirming && (
        <div className="flex-shrink-0 ml-2">{rightElement}</div>
      )}
    </button>
  );
};
