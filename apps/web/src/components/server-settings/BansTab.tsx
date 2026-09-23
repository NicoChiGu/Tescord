import React, { useState, useEffect } from "react";
import { Guild, GuildBan } from "@tescord/types";
import { Search, Ban, Unlock, AlertCircle } from "lucide-react";
import { API_BASE, resolveServerUrl } from "../../config.js";
import { useAuthStore } from "../../stores/useAuthStore.js";
import { dialog } from "../../stores/useDialogStore.js";
import { toast } from "../../stores/useToastStore.js";

interface BansTabProps {
  guild: Guild;
  onUnbanMember: (userId: string) => Promise<void>;
}

export const BansTab: React.FC<BansTabProps> = ({ guild, onUnbanMember }) => {
  const { token } = useAuthStore();
  const [bans, setBans] = useState<GuildBan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  const fetchBans = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/guilds/${guild.id}/bans`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "获取封禁黑名单失败");
      }
      const data = await res.json();
      setBans(data);
    } catch (err: any) {
      setError(err?.message || "无法拉取封禁列表");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchBans();
  }, [guild.id]);

  const handleUnban = async (ban: GuildBan) => {
    const name = ban.user?.username || "该用户";
    const confirmed = await dialog.confirm({
      title: "解除成员封禁",
      description: `确定要解除对 “${name}” 的封禁吗？解封后对方可重新凭邀请码进入服务器。`,
      variant: "info",
      confirmText: "确认解封",
    });
    if (!confirmed) return;

    try {
      await onUnbanMember(ban.userId);
      setBans((prev) => prev.filter((b) => b.userId !== ban.userId));
      toast.success(`已解除对 “${name}” 的封禁`);
    } catch (err: any) {
      toast.error(err?.message || "解封失败");
    }
  };

  const filteredBans = bans.filter((b) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      b.user?.username.toLowerCase().includes(q) ||
      b.reason?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white mb-1">
            封禁名单 ({bans.length})
          </h2>
          <p className="text-xs text-gray-400">
            被封禁的用户将无法加入或访问此服务器，直至管理员手动将其移出黑名单。
          </p>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索被封禁用户或理由..."
            className="w-full bg-[#1e1f22] border border-white/10 rounded-lg pl-9 pr-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-[#5865f2] transition-colors"
          />
        </div>
      </div>

      {error ? (
        <div className="flex items-center gap-2 p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : isLoading ? (
        <div className="py-12 text-center text-xs text-gray-400 animate-pulse">
          正在加载黑名单数据...
        </div>
      ) : filteredBans.length === 0 ? (
        <div className="rounded-xl bg-[#2b2d31]/30 border border-white/5 p-12 text-center flex flex-col items-center justify-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center text-gray-400">
            <Ban className="w-6 h-6" />
          </div>
          <div className="text-sm font-semibold text-gray-300">
            暂无被封禁的用户
          </div>
          <p className="text-xs text-gray-500 max-w-sm">
            该服务器目前非常和平，没有任何成员被列入封禁黑名单。
          </p>
        </div>
      ) : (
        <div className="rounded-xl bg-[#2b2d31]/40 border border-white/5 divide-y divide-white/5 overflow-hidden">
          {filteredBans.map((b) => (
            <div
              key={b.id}
              className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-white/[0.02] transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <img
                  src={
                    resolveServerUrl(b.user?.avatarUrl) ||
                    "https://api.dicebear.com/7.x/bottts/svg?seed=" + b.userId
                  }
                  alt={b.user?.username || "user"}
                  className="w-10 h-10 rounded-full bg-[#1e1f22] object-cover ring-2 ring-rose-500/20 shrink-0"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-white truncate">
                      {b.user?.username || "未知用户"}
                    </span>
                    <span className="text-[10px] bg-rose-500/20 text-rose-400 font-bold px-1.5 py-0.5 rounded">
                      已封禁
                    </span>
                  </div>
                  <div className="text-xs text-gray-300 mt-0.5">
                    理由：{b.reason || "违反社区守则"}
                  </div>
                  <div className="text-[11px] text-gray-500 mt-1">
                    封禁时间：{new Date(b.createdAt).toLocaleString()}
                  </div>
                </div>
              </div>

              <button
                onClick={() => handleUnban(b)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-300 hover:text-white bg-[#1e1f22] hover:bg-[#248046] border border-white/5 transition-all self-start sm:self-center"
              >
                <Unlock className="w-3.5 h-3.5" />
                <span>解除封禁</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
