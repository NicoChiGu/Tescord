import React, { useEffect, useRef } from "react";
import { X } from "lucide-react";

const openModalIds: symbol[] = [];
let originalBodyOverflow = "";

interface BaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  showCloseButton?: boolean;
}

export const BaseModal: React.FC<BaseModalProps> = ({
  isOpen,
  onClose,
  title,
  icon,
  children,
  className = "max-w-md",
  showCloseButton = true,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const modalId = useRef(Symbol("base-modal"));
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;

    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (openModalIds.length === 0) {
      originalBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    openModalIds.push(modalId.current);
    containerRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === "Escape" &&
        openModalIds[openModalIds.length - 1] === modalId.current
      ) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        onCloseRef.current();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      const index = openModalIds.indexOf(modalId.current);
      if (index !== -1) openModalIds.splice(index, 1);
      if (openModalIds.length === 0)
        document.body.style.overflow = originalBodyOverflow;
      previousFocus?.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 sm:p-4 animate-in fade-in duration-150 overscroll-contain"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={`w-full min-w-0 max-h-[calc(100dvh-1.5rem)] ${className} rounded-2xl bg-[#313338] p-4 sm:p-6 shadow-2xl border border-[#3f4147] text-white flex flex-col space-y-4 overflow-y-auto overscroll-contain animate-in zoom-in-95 duration-150`}
        onClick={(e) => e.stopPropagation()}
      >
        {(title || showCloseButton) && (
          <div className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-[#313338]">
            <div className="flex items-center gap-2.5 font-bold text-lg text-white">
              {icon}
              <span>{title}</span>
            </div>
            {showCloseButton && (
              <button
                type="button"
                onClick={onClose}
                className="text-gray-400 hover:text-white p-1 rounded-md hover:bg-white/5 transition-colors"
                aria-label="关闭"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        )}
        {children}
      </div>
    </div>
  );
};
