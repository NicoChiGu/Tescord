import React, { useState, useRef, useEffect, useId } from "react";
import { ChevronDown, Check } from "lucide-react";
import { useTranslation } from "react-i18next";

export interface SelectOption {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
}

export interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  menuClassName?: string;
  "data-testid"?: string;
  id?: string;
}

export const Select: React.FC<SelectProps> = ({
  value,
  onChange,
  options,
  placeholder,
  emptyText,
  disabled = false,
  className = "",
  triggerClassName = "",
  menuClassName = "",
  "data-testid": testId,
  id,
}) => {
  const { t } = useTranslation("common");
  const effectivePlaceholder =
    placeholder !== undefined ? placeholder : t("selectPlaceholder");
  const effectiveEmptyText =
    emptyText !== undefined ? emptyText : t("noOptions");
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const generatedId = useId();
  const selectId = id || generatedId;

  const selectedOption = options.find((opt) => opt.value === value);

  // 点击外部自动关闭
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  // 展开时同步高亮位置
  useEffect(() => {
    if (isOpen) {
      const idx = options.findIndex((opt) => opt.value === value);
      setHighlightedIndex(idx >= 0 ? idx : 0);
    } else {
      setHighlightedIndex(-1);
    }
  }, [isOpen, value, options]);

  // 键盘快捷键支持
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;

    if (!isOpen) {
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(e.key)) {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((prev) => {
        let next = prev + 1;
        while (next < options.length && options[next].disabled) {
          next++;
        }
        return next < options.length ? next : prev;
      });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((prev) => {
        let next = prev - 1;
        while (next >= 0 && options[next].disabled) {
          next--;
        }
        return next >= 0 ? next : prev;
      });
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (
        highlightedIndex >= 0 &&
        highlightedIndex < options.length &&
        !options[highlightedIndex].disabled
      ) {
        onChange(options[highlightedIndex].value);
        setIsOpen(false);
      }
    }
  };

  const handleSelect = (optionValue: string, isOptDisabled?: boolean) => {
    if (disabled || isOptDisabled) return;
    onChange(optionValue);
    setIsOpen(false);
  };

  return (
    <div
      ref={containerRef}
      className={`relative w-full ${className}`}
      onKeyDown={handleKeyDown}
    >
      <button
        type="button"
        id={selectId}
        data-testid={testId}
        disabled={disabled}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={`w-full bg-[#1e1f22] text-discord-textHeader px-3 py-2.5 rounded text-sm focus:outline-none focus:ring-2 focus:ring-discord-brand transition border border-transparent hover:border-[#35373c] flex items-center justify-between cursor-pointer select-none disabled:opacity-50 disabled:cursor-not-allowed ${triggerClassName}`}
      >
        <span className="truncate text-left flex-1 mr-2">
          {selectedOption ? (
            selectedOption.label
          ) : (
            <span className="text-discord-textMuted">
              {effectivePlaceholder}
            </span>
          )}
        </span>
        <ChevronDown
          className={`w-4 h-4 text-discord-textMuted flex-shrink-0 transition-transform duration-200 ${
            isOpen ? "rotate-180 text-discord-textHeader" : ""
          }`}
        />
      </button>

      {isOpen && (
        <div
          ref={menuRef}
          role="listbox"
          tabIndex={-1}
          className={`absolute left-0 right-0 mt-1.5 z-50 bg-[#1e1f22] border border-[#2b2d31] rounded-md shadow-2xl max-h-60 overflow-y-auto py-1 scrollbar-thin scrollbar-thumb-[#1a1b1e] scrollbar-track-transparent animate-in fade-in-50 zoom-in-95 duration-100 ${menuClassName}`}
        >
          {options.length === 0 ? (
            <div className="px-3 py-2 text-xs text-discord-textMuted text-center">
              {effectiveEmptyText}
            </div>
          ) : (
            options.map((opt, idx) => {
              const isSelected = opt.value === value;
              const isHighlighted = idx === highlightedIndex;

              return (
                <div
                  key={`${opt.value}-${idx}`}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => handleSelect(opt.value, opt.disabled)}
                  onMouseEnter={() => !opt.disabled && setHighlightedIndex(idx)}
                  className={`px-3 py-2 text-sm mx-1 rounded cursor-pointer flex items-center justify-between transition-colors select-none ${
                    opt.disabled
                      ? "opacity-40 cursor-not-allowed text-discord-textMuted"
                      : isSelected
                        ? "bg-discord-brand/20 text-white font-medium"
                        : isHighlighted
                          ? "bg-[#35373c] text-discord-textHeader"
                          : "text-discord-textNormal hover:bg-[#35373c]"
                  }`}
                >
                  <span className="truncate flex-1 mr-2">{opt.label}</span>
                  {isSelected && (
                    <Check className="w-4 h-4 text-discord-brand flex-shrink-0" />
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
