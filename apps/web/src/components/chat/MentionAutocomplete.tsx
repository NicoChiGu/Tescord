import React, { useEffect, useRef } from "react";
import { User, GuildMember, Role, UserStatus } from "@tescord/types";
import { AtSign, Volume2, ShieldCheck } from "lucide-react";

export interface MentionCandidate {
  id: string;
  name: string; // 插入到文本中的名字，如 everyone 或 username
  displayName: string; // 渲染名，如 昵称
  username?: string;
  avatarUrl?: string | null;
  status?: UserStatus;
  roleColor?: string;
  roleName?: string;
  isSpecial?: boolean;
  description?: string;
  user?: User;
  member?: GuildMember;
}

interface MentionAutocompleteProps {
  candidates: MentionCandidate[];
  selectedIndex: number;
  onSelect: (candidate: MentionCandidate) => void;
  onHoverIndex: (index: number) => void;
}

export const MentionAutocomplete: React.FC<MentionAutocompleteProps> = ({
  candidates,
  selectedIndex,
  onSelect,
  onHoverIndex,
}) => {
  const listRef = useRef<HTMLDivElement>(null);

  // 确保键盘高亮项始终在可视区域内
  useEffect(() => {
    if (!listRef.current) return;
    const activeItem = listRef.current.querySelector<HTMLElement>(
      `[data-index="${selectedIndex}"]`,
    );
    if (activeItem) {
      activeItem.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  if (candidates.length === 0) {
    return (
      <div className="absolute bottom-full left-0 right-0 mb-2 bg-[#2b2d31] border border-[#1f2023] rounded-lg shadow-2xl p-3 text-xs text-discord-textMuted select-none z-50 animate-fade-in flex items-center justify-center space-x-2">
        <AtSign className="w-4 h-4 opacity-50" />
        <span>未找到匹配的成员</span>
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      className="absolute bottom-full left-0 right-0 mb-2 max-h-64 overflow-y-auto bg-[#2b2d31]/95 backdrop-blur-md border border-[#1f2023] rounded-lg shadow-2xl p-1.5 select-none z-50 animate-fade-in custom-scrollbar"
      style={{
        boxShadow: "0 8px 24px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)",
      }}
    >
      <div className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-[#949ba4] border-b border-[#35373c]/50 mb-1 flex items-center justify-between">
        <span>提及候选人 (↑↓ 导航，Enter 确认)</span>
        <span className="text-[10px] font-normal lowercase text-discord-textMuted">
          {candidates.length} 项
        </span>
      </div>

      <div className="space-y-0.5">
        {candidates.map((cand, idx) => {
          const isSelected = idx === selectedIndex;

          return (
            <div
              key={cand.id}
              data-index={idx}
              onMouseEnter={() => onHoverIndex(idx)}
              onClick={() => onSelect(cand)}
              className={`flex items-center space-x-2.5 px-2.5 py-1.5 rounded-md cursor-pointer transition-colors ${
                isSelected
                  ? "bg-[#35373c] text-white"
                  : "text-discord-textNormal hover:bg-[#35373c]/60"
              }`}
            >
              {cand.isSpecial ? (
                // @everyone 或 @here 特殊广播图标
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                    cand.name === "everyone"
                      ? "bg-[#5865f2]/20 text-[#5865f2]"
                      : "bg-[#23a55a]/20 text-[#23a55a]"
                  }`}
                >
                  {cand.name === "everyone" ? (
                    <Volume2 className="w-4 h-4" />
                  ) : (
                    <AtSign className="w-4 h-4" />
                  )}
                </div>
              ) : (
                // 真实成员头像与在线指示器
                <div className="relative shrink-0">
                  {cand.avatarUrl ? (
                    <img
                      src={cand.avatarUrl}
                      alt={cand.displayName}
                      className="w-7 h-7 rounded-full object-cover bg-[#1e1f22]"
                    />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-[#5865f2] flex items-center justify-center text-xs font-bold text-white uppercase">
                      {cand.displayName.slice(0, 2)}
                    </div>
                  )}
                  {/* 在线状态圆点 */}
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#2b2d31] ${
                      cand.status === "ONLINE"
                        ? "bg-[#23a55a]"
                        : cand.status === "IDLE"
                          ? "bg-[#f0b232]"
                          : cand.status === "DND"
                            ? "bg-[#f23f43]"
                            : "bg-[#80848e]"
                    }`}
                  />
                </div>
              )}

              {/* 文本内容与身份 */}
              <div className="flex-1 min-w-0 flex items-center justify-between">
                <div className="flex items-center space-x-1.5 truncate">
                  <span
                    className="font-medium text-sm truncate"
                    style={{ color: cand.roleColor || undefined }}
                  >
                    @{cand.displayName}
                  </span>
                  {cand.username && cand.username !== cand.displayName && (
                    <span className="text-xs text-discord-textMuted truncate">
                      {cand.username}
                    </span>
                  )}
                </div>

                {/* 右侧角色名称标签或说明 */}
                {cand.isSpecial ? (
                  <span className="text-[11px] text-discord-textMuted shrink-0 ml-2">
                    {cand.description}
                  </span>
                ) : cand.roleName ? (
                  <span
                    className="text-[11px] px-1.5 py-0.5 rounded text-xs shrink-0 ml-2 bg-[#1e1f22]/60"
                    style={{ color: cand.roleColor || "#b5bac1" }}
                  >
                    {cand.roleName}
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
