import { create } from "zustand";
import {
  User,
  LoginDTO,
  RegisterDTO,
  UpdateProfileDTO,
  AuthTokens,
  SavedAccount,
} from "@tescord/types";
import { API_BASE } from "../config.js";
import { cancelPendingRequests } from "../services/apiClient.js";

const MAX_SAVED_ACCOUNTS = 10;
const SAVED_ACCOUNTS_STORAGE_KEY = "tescord_saved_accounts";

export function getStoredSavedAccounts(): SavedAccount[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(SAVED_ACCOUNTS_STORAGE_KEY);
    if (raw) {
      const list = JSON.parse(raw);
      if (Array.isArray(list) && list.length > 0) return list;
    }
    // 兼容历史遗留的单账号记忆 tescord_last_user
    const lastUserRaw = localStorage.getItem("tescord_last_user");
    if (lastUserRaw) {
      const u: User = JSON.parse(lastUserRaw);
      const migrated: SavedAccount = {
        id: u.id,
        email: u.email,
        username: u.username,
        displayName: u.displayName,
        discriminator: u.discriminator,
        avatarUrl: u.avatarUrl,
        lastActiveAt: Date.now(),
        rememberPassword: true,
        refreshToken: localStorage.getItem("tescord_refresh_token") || undefined,
      };
      localStorage.setItem(SAVED_ACCOUNTS_STORAGE_KEY, JSON.stringify([migrated]));
      return [migrated];
    }
    return [];
  } catch {
    return [];
  }
}

export function persistSavedAccounts(accounts: SavedAccount[]): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(
      SAVED_ACCOUNTS_STORAGE_KEY,
      JSON.stringify(accounts.slice(0, MAX_SAVED_ACCOUNTS))
    );
  } catch {
    // 忽略持久化异常
  }
}

export function upsertSavedAccount(
  user: User,
  tokens?: { refreshToken?: string },
  rememberPassword?: boolean
): SavedAccount[] {
  const accounts = getStoredSavedAccounts();
  const existingIdx = accounts.findIndex(
    (a) =>
      a.id === user.id ||
      (a.email && user.email && a.email.toLowerCase() === user.email.toLowerCase())
  );

  const shouldRemember = rememberPassword ?? true;
  const tokenToStore = shouldRemember ? tokens?.refreshToken : undefined;

  const newItem: SavedAccount = {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    discriminator: user.discriminator,
    avatarUrl: user.avatarUrl,
    lastActiveAt: Date.now(),
    rememberPassword: shouldRemember,
    refreshToken: tokenToStore,
  };

  let updated: SavedAccount[];
  if (existingIdx >= 0) {
    const existing = accounts[existingIdx];
    updated = [
      {
        ...existing,
        ...newItem,
        refreshToken: shouldRemember ? (tokenToStore || existing.refreshToken) : undefined,
      },
      ...accounts.filter((_, idx) => idx !== existingIdx),
    ];
  } else {
    updated = [newItem, ...accounts];
  }

  updated.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  persistSavedAccounts(updated);
  return updated;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  isReauthModalOpen: boolean;
  reauthReason: string | null;
  lastActiveUser: User | null;
  savedAccounts: SavedAccount[];

  initAuth: () => Promise<void>;
  login: (dto: LoginDTO) => Promise<void>;
  register: (dto: RegisterDTO) => Promise<void>;
  logout: () => void;
  setUser: (user: User | null) => void;
  updateProfile: (dto: UpdateProfileDTO) => Promise<void>;
  refreshAuth: () => Promise<boolean>;
  getAuthHeaders: () => Record<string, string>;
  openReauthModal: (reason?: string) => void;
  closeReauthModal: () => void;
  reauth: (password: string) => Promise<void>;
  switchAccount: () => void;
  removeSavedAccount: (idOrEmail: string) => void;
  loginWithSavedAccount: (account: SavedAccount) => Promise<boolean>;
}

const syncDesktopWindowMode = (mode: "auth" | "main") => {
  if (typeof window !== "undefined" && window.electronAPI) {
    if (mode === "main") {
      window.electronAPI.notifyAuthSuccess?.().catch(() => {});
    } else {
      window.electronAPI.notifyLogout?.().catch(() => {});
    }
    window.electronAPI.setWindowMode?.(mode).catch(() => {});
  }
};

let activeRefreshPromise: Promise<boolean> | null = null;
let proactiveRefreshTimer: ReturnType<typeof setTimeout> | null = null;

// Access Token 寿命 15 分钟，在第 12 分钟 (720 秒) 执行主动静默预续期
const PROACTIVE_REFRESH_INTERVAL_MS = 12 * 60 * 1000;

function clearProactiveRefreshTimer() {
  if (proactiveRefreshTimer) {
    clearTimeout(proactiveRefreshTimer);
    proactiveRefreshTimer = null;
  }
}

function scheduleProactiveRefresh(triggerFn: () => Promise<boolean>) {
  clearProactiveRefreshTimer();
  proactiveRefreshTimer = setTimeout(async () => {
    try {
      await triggerFn();
    } catch {
      // 容错处理，由后续请求或重试接管
    }
  }, PROACTIVE_REFRESH_INTERVAL_MS);
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  setUser: (user) => set({ user }),
  accessToken: localStorage.getItem("tescord_access_token"),
  refreshToken: localStorage.getItem("tescord_refresh_token"),
  token: localStorage.getItem("tescord_access_token"),
  isAuthenticated: false,
  isLoading: true,
  error: null,
  isReauthModalOpen: false,
  reauthReason: null,
  savedAccounts: getStoredSavedAccounts(),
  lastActiveUser: (() => {
    try {
      const saved =
        typeof localStorage !== "undefined"
          ? localStorage.getItem("tescord_last_user")
          : null;
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  })(),

  getAuthHeaders: () => {
    const token = get().accessToken;
    const headers: Record<string, string> = {};
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    return headers;
  },

  initAuth: async () => {
    set({ isLoading: true, error: null });
    const accounts = getStoredSavedAccounts();
    set({ savedAccounts: accounts });

    const accessToken = localStorage.getItem("tescord_access_token");
    const refreshToken = localStorage.getItem("tescord_refresh_token");

    // 1. 优先尝试本地活跃的 access/refresh token
    if (accessToken || refreshToken) {
      try {
        if (accessToken) {
          const res = await fetch(`${API_BASE}/api/auth/me`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });

          if (res.ok) {
            const user: User = await res.json();
            localStorage.setItem("tescord_last_user", JSON.stringify(user));
            const updated = upsertSavedAccount(
              user,
              { refreshToken: refreshToken || undefined },
              true
            );
            set({
              user,
              lastActiveUser: user,
              accessToken,
              token: accessToken,
              refreshToken,
              isAuthenticated: true,
              isLoading: false,
              savedAccounts: updated,
            });
            syncDesktopWindowMode("main");
            scheduleProactiveRefresh(() => get().refreshAuth());
            return;
          }
        }

        if (refreshToken) {
          const refreshed = await get().refreshAuth();
          if (refreshed) {
            syncDesktopWindowMode("main");
            return;
          }
        }
      } catch {
        // 出错继续尝试免密账号检查
      }
    }

    // 2. 检查是否有开启了 7天免密 且携带长效 refreshToken 的已保存账号
    const autoLoginAccount = accounts.find((a) => a.rememberPassword && Boolean(a.refreshToken));
    if (autoLoginAccount) {
      const ok = await get().loginWithSavedAccount(autoLoginAccount);
      if (ok) {
        return;
      }
    }

    // 3. 无有效令牌或免密失败，停留在未登录态并进入账号选择
    clearProactiveRefreshTimer();
    localStorage.removeItem("tescord_access_token");
    localStorage.removeItem("tescord_refresh_token");
    set({
      user: null,
      accessToken: null,
      token: null,
      refreshToken: null,
      isAuthenticated: false,
      isLoading: false,
    });
    syncDesktopWindowMode("auth");
  },

  login: async (dto: LoginDTO) => {
    set({ error: null });
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emailOrUsername: dto.emailOrUsername,
          password: dto.password,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "登录失败");
      }

      const tokens = data as AuthTokens;
      const rememberMe = dto.rememberMe !== false;
      localStorage.setItem("tescord_access_token", tokens.accessToken);
      if (rememberMe) {
        localStorage.setItem("tescord_refresh_token", tokens.refreshToken);
      } else {
        localStorage.removeItem("tescord_refresh_token");
      }
      localStorage.setItem("tescord_last_user", JSON.stringify(tokens.user));

      const updatedAccounts = upsertSavedAccount(
        tokens.user,
        { refreshToken: tokens.refreshToken },
        rememberMe
      );

      set({
        user: tokens.user,
        lastActiveUser: tokens.user,
        accessToken: tokens.accessToken,
        token: tokens.accessToken,
        refreshToken: rememberMe ? tokens.refreshToken : null,
        isAuthenticated: true,
        isLoading: false,
        savedAccounts: updatedAccounts,
        error: null,
      });
      syncDesktopWindowMode("main");
      if (rememberMe) {
        scheduleProactiveRefresh(() => get().refreshAuth());
      }
    } catch (err: any) {
      set({ error: err.message });
      throw err;
    }
  },

  register: async (dto: RegisterDTO) => {
    set({ error: null });
    try {
      const res = await fetch(`${API_BASE}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dto),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "注册失败");
      }

      const tokens = data as AuthTokens;
      localStorage.setItem("tescord_access_token", tokens.accessToken);
      localStorage.setItem("tescord_refresh_token", tokens.refreshToken);
      localStorage.setItem("tescord_last_user", JSON.stringify(tokens.user));

      const updatedAccounts = upsertSavedAccount(
        tokens.user,
        { refreshToken: tokens.refreshToken },
        true
      );

      set({
        user: tokens.user,
        lastActiveUser: tokens.user,
        accessToken: tokens.accessToken,
        token: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        isAuthenticated: true,
        isLoading: false,
        savedAccounts: updatedAccounts,
        error: null,
      });
      syncDesktopWindowMode("main");
      scheduleProactiveRefresh(() => get().refreshAuth());
    } catch (err: any) {
      set({ error: err.message });
      throw err;
    }
  },

  loginWithSavedAccount: async (account: SavedAccount) => {
    set({ isLoading: true, error: null });
    if (account.refreshToken) {
      try {
        const res = await fetch(`${API_BASE}/api/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken: account.refreshToken }),
        });

        if (res.ok) {
          const data = (await res.json()) as AuthTokens;
          localStorage.setItem("tescord_access_token", data.accessToken);
          localStorage.setItem("tescord_refresh_token", data.refreshToken);
          localStorage.setItem("tescord_last_user", JSON.stringify(data.user));

          const updated = upsertSavedAccount(
            data.user,
            { refreshToken: data.refreshToken },
            true
          );

          set({
            user: data.user,
            lastActiveUser: data.user,
            accessToken: data.accessToken,
            token: data.accessToken,
            refreshToken: data.refreshToken,
            isAuthenticated: true,
            isLoading: false,
            savedAccounts: updated,
            error: null,
          });
          syncDesktopWindowMode("main");
          scheduleProactiveRefresh(() => get().refreshAuth());
          return true;
        }
      } catch {
        // 静默刷新失败
      }
    }

    // 凭据无效或已过期，将该账号的 refreshToken 置空，保留账号卡片
    const current = getStoredSavedAccounts();
    const updated = current.map((a) =>
      a.id === account.id ||
      (a.email && account.email && a.email.toLowerCase() === account.email.toLowerCase())
        ? { ...a, refreshToken: undefined }
        : a
    );
    persistSavedAccounts(updated);
    set({ isLoading: false, savedAccounts: updated });
    return false;
  },

  removeSavedAccount: (idOrEmail: string) => {
    const current = getStoredSavedAccounts();
    const target = idOrEmail.toLowerCase();
    const updated = current.filter(
      (a) => a.id !== idOrEmail && a.email?.toLowerCase() !== target
    );
    persistSavedAccounts(updated);
    const last = get().lastActiveUser;
    if (last && (last.id === idOrEmail || last.email?.toLowerCase() === target)) {
      localStorage.removeItem("tescord_last_user");
      set({ lastActiveUser: null });
    }
    set({ savedAccounts: updated });
  },

  refreshAuth: async () => {
    // 1. 若当前已有正在进行的刷新请求，直接复用 Promise（防并发冲突）
    if (activeRefreshPromise) {
      return activeRefreshPromise;
    }

    const refreshToken =
      get().refreshToken || localStorage.getItem("tescord_refresh_token");
    if (!refreshToken) return false;

    activeRefreshPromise = (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken }),
        });

        if (!res.ok) {
          clearProactiveRefreshTimer();
          return false;
        }

        const data = (await res.json()) as AuthTokens;
        localStorage.setItem("tescord_access_token", data.accessToken);
        localStorage.setItem("tescord_refresh_token", data.refreshToken);
        localStorage.setItem("tescord_last_user", JSON.stringify(data.user));

        const accounts = getStoredSavedAccounts();
        const updated = accounts.map((acc) => {
          if (
            acc.id === data.user.id ||
            (acc.email &&
              data.user.email &&
              acc.email.toLowerCase() === data.user.email.toLowerCase())
          ) {
            return {
              ...acc,
              refreshToken: acc.rememberPassword ? data.refreshToken : undefined,
              lastActiveAt: Date.now(),
              avatarUrl: data.user.avatarUrl ?? acc.avatarUrl,
              displayName: data.user.displayName ?? acc.displayName,
              username: data.user.username ?? acc.username,
            };
          }
          return acc;
        });
        persistSavedAccounts(updated);

        set({
          user: data.user,
          lastActiveUser: data.user,
          accessToken: data.accessToken,
          token: data.accessToken,
          refreshToken: data.refreshToken,
          isAuthenticated: true,
          isLoading: false,
          savedAccounts: updated,
          error: null,
        });

        // 成功换票后安排下一轮主动静默预续期
        scheduleProactiveRefresh(() => get().refreshAuth());
        return true;
      } catch {
        return false;
      } finally {
        activeRefreshPromise = null;
      }
    })();

    return activeRefreshPromise;
  },

  logout: () => {
    clearProactiveRefreshTimer();
    const currentUser = get().user || get().lastActiveUser;
    if (currentUser) {
      const current = getStoredSavedAccounts();
      const updated = current.map((acc) => {
        if (
          acc.id === currentUser.id ||
          (acc.email &&
            currentUser.email &&
            acc.email.toLowerCase() === currentUser.email.toLowerCase())
        ) {
          return {
            ...acc,
            refreshToken: undefined, // 登出清除免密凭据，保留卡片
          };
        }
        return acc;
      });
      persistSavedAccounts(updated);
      set({ savedAccounts: updated });
    }

    localStorage.removeItem("tescord_access_token");
    localStorage.removeItem("tescord_refresh_token");
    set({
      user: null,
      accessToken: null,
      token: null,
      refreshToken: null,
      isAuthenticated: false,
      isLoading: false,
      isReauthModalOpen: false,
      reauthReason: null,
      error: null,
    });
    syncDesktopWindowMode("auth");
  },

  openReauthModal: (reason?: string) => {
    const currentOrLast = get().user || get().lastActiveUser;
    set({
      isReauthModalOpen: true,
      reauthReason: reason || null,
      lastActiveUser: currentOrLast,
    });
  },

  closeReauthModal: () => {
    set({ isReauthModalOpen: false, reauthReason: null });
  },

  reauth: async (password: string) => {
    const currentUser = get().user || get().lastActiveUser;
    const account = currentUser?.email || currentUser?.username;
    if (!account) {
      throw new Error("未能获取当前账号信息，请切换账号重新登录");
    }

    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        emailOrUsername: account,
        password,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "验证失败，请确认密码是否正确");
    }

    const tokens = data as AuthTokens;
    localStorage.setItem("tescord_access_token", tokens.accessToken);
    localStorage.setItem("tescord_refresh_token", tokens.refreshToken);
    localStorage.setItem("tescord_last_user", JSON.stringify(tokens.user));

    const updated = upsertSavedAccount(
      tokens.user,
      { refreshToken: tokens.refreshToken },
      true
    );

    set({
      user: tokens.user,
      lastActiveUser: tokens.user,
      accessToken: tokens.accessToken,
      token: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      isAuthenticated: true,
      savedAccounts: updated,
      isReauthModalOpen: false,
      reauthReason: null,
      error: null,
    });
    syncDesktopWindowMode("main");
    scheduleProactiveRefresh(() => get().refreshAuth());
  },

  switchAccount: () => {
    cancelPendingRequests("用户切换账号");
    get().logout();
    set({
      isReauthModalOpen: false,
      reauthReason: null,
      lastActiveUser: null,
    });
    syncDesktopWindowMode("auth");
  },

  updateProfile: async (dto: UpdateProfileDTO) => {
    const headers = get().getAuthHeaders();
    const res = await fetch(`${API_BASE}/api/users/@me`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(dto),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "更新个人资料失败");
    }

    set({ user: data as User });
  },
}));

if (typeof window !== "undefined") {
  (window as any).useAuthStore = useAuthStore;
}
