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
const REFRESH_KEY = "tescord_refresh_token";
const ACCESS_KEY = "tescord_access_token";
let authGeneration = 0;

function currentRefreshToken(): string | null {
  return (
    sessionStorage.getItem(REFRESH_KEY) || localStorage.getItem(REFRESH_KEY)
  );
}

function storeActiveTokens(tokens: AuthTokens, remember: boolean): void {
  if (remember) {
    localStorage.setItem(ACCESS_KEY, tokens.accessToken);
    sessionStorage.removeItem(ACCESS_KEY);
    localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
    sessionStorage.removeItem(REFRESH_KEY);
  } else {
    sessionStorage.setItem(ACCESS_KEY, tokens.accessToken);
    localStorage.removeItem(ACCESS_KEY);
    sessionStorage.setItem(REFRESH_KEY, tokens.refreshToken);
    localStorage.removeItem(REFRESH_KEY);
  }
  localStorage.setItem("tescord_last_user", JSON.stringify(tokens.user));
}

function clearActiveTokens(): void {
  localStorage.removeItem(ACCESS_KEY);
  sessionStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  sessionStorage.removeItem(REFRESH_KEY);
}

function accessExpiresAt(token: string | null): number {
  if (!token) return 0;
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return typeof payload.exp === "number" ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

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
        refreshToken:
          localStorage.getItem("tescord_refresh_token") || undefined,
      };
      localStorage.setItem(
        SAVED_ACCOUNTS_STORAGE_KEY,
        JSON.stringify([migrated]),
      );
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
      JSON.stringify(accounts.slice(0, MAX_SAVED_ACCOUNTS)),
    );
  } catch {
    // 忽略持久化异常
  }
}

export function upsertSavedAccount(
  user: User,
  tokens?: { refreshToken?: string },
  rememberPassword?: boolean,
): SavedAccount[] {
  const accounts = getStoredSavedAccounts();
  const existingIdx = accounts.findIndex(
    (a) =>
      a.id === user.id ||
      (a.email &&
        user.email &&
        a.email.toLowerCase() === user.email.toLowerCase()),
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
        refreshToken: shouldRemember
          ? tokenToStore || existing.refreshToken
          : undefined,
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
  refreshFailure: "invalid" | "transient" | null;

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
let activeRefreshGeneration = -1;
let proactiveRefreshTimer: ReturnType<typeof setTimeout> | null = null;

// Access Token 寿命 15 分钟，在第 12 分钟 (720 秒) 执行主动静默预续期
const PROACTIVE_REFRESH_INTERVAL_MS = 12 * 60 * 1000;

function clearProactiveRefreshTimer() {
  if (proactiveRefreshTimer) {
    clearTimeout(proactiveRefreshTimer);
    proactiveRefreshTimer = null;
  }
}

function scheduleProactiveRefresh(
  triggerFn: () => Promise<boolean>,
  token?: string | null,
) {
  clearProactiveRefreshTimer();
  const expiry = accessExpiresAt(token || useAuthStore.getState().accessToken);
  const delay =
    useAuthStore.getState().refreshFailure === "transient"
      ? 30_000
      : expiry
        ? Math.max(
            1_000,
            Math.min(
              PROACTIVE_REFRESH_INTERVAL_MS,
              expiry - Date.now() - 60_000,
            ),
          )
        : PROACTIVE_REFRESH_INTERVAL_MS;
  proactiveRefreshTimer = setTimeout(async () => {
    try {
      await triggerFn();
    } catch {
      // 容错处理，由后续请求或重试接管
    }
  }, delay);
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  setUser: (user) => set({ user }),
  accessToken:
    sessionStorage.getItem(ACCESS_KEY) || localStorage.getItem(ACCESS_KEY),
  refreshToken: currentRefreshToken(),
  token: sessionStorage.getItem(ACCESS_KEY) || localStorage.getItem(ACCESS_KEY),
  isAuthenticated: false,
  isLoading: true,
  error: null,
  refreshFailure: null,
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

    const accessToken =
      sessionStorage.getItem(ACCESS_KEY) || localStorage.getItem(ACCESS_KEY);
    const refreshToken = currentRefreshToken();

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
            const remember = Boolean(localStorage.getItem(REFRESH_KEY));
            const updated = upsertSavedAccount(
              user,
              { refreshToken: refreshToken || undefined },
              remember,
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

    if (get().refreshFailure === "transient") {
      set({ isLoading: false });
      return;
    }

    // 2. 检查已保存的免密账号
    const autoLoginAccount = accounts.find(
      (a) => a.rememberPassword && Boolean(a.refreshToken),
    );
    if (autoLoginAccount) {
      const ok = await get().loginWithSavedAccount(autoLoginAccount);
      if (ok) {
        return;
      }
    }

    // 3. 无有效令牌或免密失败，停留在未登录态并进入账号选择
    clearProactiveRefreshTimer();
    if (get().refreshFailure !== "transient") clearActiveTokens();
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
      authGeneration++;
      storeActiveTokens(tokens, rememberMe);

      const updatedAccounts = upsertSavedAccount(
        tokens.user,
        { refreshToken: tokens.refreshToken },
        rememberMe,
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
      authGeneration++;
      storeActiveTokens(tokens, true);

      const updatedAccounts = upsertSavedAccount(
        tokens.user,
        { refreshToken: tokens.refreshToken },
        true,
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
    const generation = authGeneration;
    if (account.refreshToken) {
      try {
        const res = await fetch(`${API_BASE}/api/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken: account.refreshToken }),
        });

        if (res.ok) {
          const data = (await res.json()) as AuthTokens;
          if (generation !== authGeneration || data.user.id !== account.id)
            return false;
          authGeneration++;
          storeActiveTokens(data, true);

          const updated = upsertSavedAccount(
            data.user,
            { refreshToken: data.refreshToken },
            true,
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
        if (res.status !== 400 && res.status !== 401 && res.status !== 403) {
          set({ isLoading: false });
          return false;
        }
      } catch {
        // 临时网络故障不销毁免密凭据。
        set({ isLoading: false });
        return false;
      }
    }

    // 凭据无效或已过期，将该账号的 refreshToken 置空，保留账号卡片
    const current = getStoredSavedAccounts();
    const updated = current.map((a) =>
      a.id === account.id ||
      (a.email &&
        account.email &&
        a.email.toLowerCase() === account.email.toLowerCase())
        ? { ...a, refreshToken: undefined }
        : a,
    );
    persistSavedAccounts(updated);
    set({ isLoading: false, savedAccounts: updated });
    return false;
  },

  removeSavedAccount: (idOrEmail: string) => {
    const current = getStoredSavedAccounts();
    const target = idOrEmail.toLowerCase();
    const updated = current.filter(
      (a) => a.id !== idOrEmail && a.email?.toLowerCase() !== target,
    );
    persistSavedAccounts(updated);
    const last = get().lastActiveUser;
    if (
      last &&
      (last.id === idOrEmail || last.email?.toLowerCase() === target)
    ) {
      localStorage.removeItem("tescord_last_user");
      set({ lastActiveUser: null });
    }
    set({ savedAccounts: updated });
  },

  refreshAuth: async () => {
    if (activeRefreshPromise && activeRefreshGeneration === authGeneration) {
      return activeRefreshPromise;
    }
    if (!currentRefreshToken()) {
      set({ refreshFailure: "invalid" });
      return false;
    }
    const generation = authGeneration;
    activeRefreshGeneration = generation;
    const expectedUserId = get().user?.id || get().lastActiveUser?.id;
    const startedRefreshToken = currentRefreshToken();
    activeRefreshPromise = (async () => {
      try {
        const perform = async (): Promise<boolean> => {
          const refreshToken = currentRefreshToken();
          if (!refreshToken || generation !== authGeneration) return false;
          // Another tab may have rotated the token while this tab waited for the lock.
          const newerAccess = localStorage.getItem(ACCESS_KEY);
          if (
            refreshToken !== startedRefreshToken &&
            accessExpiresAt(newerAccess) > Date.now() + 60_000
          ) {
            set({
              accessToken: newerAccess,
              token: newerAccess,
              refreshToken,
              refreshFailure: null,
            });
            scheduleProactiveRefresh(() => get().refreshAuth(), newerAccess);
            return true;
          }
          const res = await fetch(`${API_BASE}/api/auth/refresh`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refreshToken }),
          });
          if (!res.ok) {
            const invalid =
              res.status === 400 || res.status === 401 || res.status === 403;
            set({ refreshFailure: invalid ? "invalid" : "transient" });
            if (invalid) clearProactiveRefreshTimer();
            else scheduleProactiveRefresh(() => get().refreshAuth());
            return false;
          }
          const data = (await res.json()) as AuthTokens;
          if (
            generation !== authGeneration ||
            (expectedUserId && data.user.id !== expectedUserId)
          )
            return false;
          const remembered = Boolean(localStorage.getItem(REFRESH_KEY));
          storeActiveTokens(data, remembered);

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
                refreshToken: acc.rememberPassword
                  ? data.refreshToken
                  : undefined,
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
            refreshFailure: null,
          });
          scheduleProactiveRefresh(() => get().refreshAuth(), data.accessToken);
          return true;
        };
        if (navigator.locks?.request) {
          return await navigator.locks.request("tescord-auth-refresh", perform);
        }
        return await perform();
      } catch {
        if (generation === authGeneration) {
          set({ refreshFailure: "transient" });
          scheduleProactiveRefresh(() => get().refreshAuth());
        }
        return false;
      } finally {
        if (activeRefreshGeneration === generation) activeRefreshPromise = null;
      }
    })();

    return activeRefreshPromise;
  },

  logout: () => {
    authGeneration++;
    clearProactiveRefreshTimer();
    cancelPendingRequests("用户已退出登录");
    const tokenToRevoke = currentRefreshToken();
    if (tokenToRevoke) {
      fetch(`${API_BASE}/api/auth/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: tokenToRevoke }),
        keepalive: true,
      }).catch(() => {});
    }
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

    clearActiveTokens();
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
    authGeneration++;
    storeActiveTokens(
      tokens,
      getStoredSavedAccounts().some(
        (a) => a.id === tokens.user.id && a.rememberPassword,
      ),
    );

    const updated = upsertSavedAccount(
      tokens.user,
      { refreshToken: tokens.refreshToken },
      getStoredSavedAccounts().some(
        (a) => a.id === tokens.user.id && a.rememberPassword,
      ),
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
    authGeneration++;
    clearProactiveRefreshTimer();
    cancelPendingRequests("用户切换账号");
    clearActiveTokens();
    set({
      user: null,
      accessToken: null,
      token: null,
      refreshToken: null,
      isAuthenticated: false,
      isLoading: false,
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
  const refreshOnResume = () => {
    const state = useAuthStore.getState();
    if (
      !state.isAuthenticated &&
      state.refreshFailure === "transient" &&
      currentRefreshToken()
    ) {
      void state.initAuth();
      return;
    }
    if (
      state.isAuthenticated &&
      currentRefreshToken() &&
      accessExpiresAt(state.accessToken) < Date.now() + 2 * 60_000
    ) {
      void state.refreshAuth();
    }
  };
  window.addEventListener("online", refreshOnResume);
  window.addEventListener("focus", refreshOnResume);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshOnResume();
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== REFRESH_KEY || !event.newValue) return;
    const state = useAuthStore.getState();
    if (
      !state.isAuthenticated ||
      !state.user ||
      sessionStorage.getItem(REFRESH_KEY)
    )
      return;
    const saved = getStoredSavedAccounts().find(
      (account) => account.id === state.user?.id,
    );
    if (saved?.refreshToken !== event.newValue) return;
    const accessToken = localStorage.getItem(ACCESS_KEY);
    useAuthStore.setState({
      refreshToken: event.newValue,
      accessToken,
      token: accessToken,
    });
    scheduleProactiveRefresh(
      () => useAuthStore.getState().refreshAuth(),
      accessToken,
    );
  });
}
