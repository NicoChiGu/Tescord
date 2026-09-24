import { create } from "zustand";
import {
  User,
  LoginDTO,
  RegisterDTO,
  UpdateProfileDTO,
  AuthTokens,
} from "@tescord/types";
import { API_BASE } from "../config.js";
import { cancelPendingRequests } from "../services/apiClient.js";

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
  lastActiveUser: (() => {
    try {
      const saved = typeof localStorage !== "undefined" ? localStorage.getItem("tescord_last_user") : null;
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
    const accessToken = localStorage.getItem("tescord_access_token");
    const refreshToken = localStorage.getItem("tescord_refresh_token");

    if (!accessToken && !refreshToken) {
      set({ isLoading: false, isAuthenticated: false, user: null });
      syncDesktopWindowMode("auth");
      return;
    }

    try {
      // 1. 尝试使用现有的 Access Token 请求个人信息
      if (accessToken) {
        const res = await fetch(`${API_BASE}/api/auth/me`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (res.ok) {
          const user: User = await res.json();
          localStorage.setItem("tescord_last_user", JSON.stringify(user));
          set({
            user,
            lastActiveUser: user,
            accessToken,
            token: accessToken,
            refreshToken,
            isAuthenticated: true,
            isLoading: false,
          });
          syncDesktopWindowMode("main");
          return;
        }
      }

      // 2. Access Token 失效，尝试使用 Refresh Token 无感静默刷新
      if (refreshToken) {
        const refreshed = await get().refreshAuth();
        if (refreshed) {
          syncDesktopWindowMode("main");
          return;
        }
      }

      // 3. 全部失效，清除本地凭据
      get().logout();
    } catch {
      get().logout();
    } finally {
      set({ isLoading: false });
    }
  },

  login: async (dto: LoginDTO) => {
    set({ error: null });
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dto),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "登录失败");
      }

      const tokens = data as AuthTokens;
      localStorage.setItem("tescord_access_token", tokens.accessToken);
      localStorage.setItem("tescord_refresh_token", tokens.refreshToken);
      localStorage.setItem("tescord_last_user", JSON.stringify(tokens.user));

      set({
        user: tokens.user,
        lastActiveUser: tokens.user,
        accessToken: tokens.accessToken,
        token: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });
      syncDesktopWindowMode("main");
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

      set({
        user: tokens.user,
        lastActiveUser: tokens.user,
        accessToken: tokens.accessToken,
        token: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });
      syncDesktopWindowMode("main");
    } catch (err: any) {
      set({ error: err.message });
      throw err;
    }
  },

  refreshAuth: async () => {
    const refreshToken =
      get().refreshToken || localStorage.getItem("tescord_refresh_token");
    if (!refreshToken) return false;

    try {
      const res = await fetch(`${API_BASE}/api/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });

      if (!res.ok) return false;

      const data = (await res.json()) as AuthTokens;
      localStorage.setItem("tescord_access_token", data.accessToken);
      localStorage.setItem("tescord_refresh_token", data.refreshToken);
      localStorage.setItem("tescord_last_user", JSON.stringify(data.user));

      set({
        user: data.user,
        lastActiveUser: data.user,
        accessToken: data.accessToken,
        token: data.accessToken,
        refreshToken: data.refreshToken,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });
      return true;
    } catch {
      return false;
    }
  },

  logout: () => {
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

    set({
      user: tokens.user,
      lastActiveUser: tokens.user,
      accessToken: tokens.accessToken,
      token: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      isAuthenticated: true,
      isReauthModalOpen: false,
      reauthReason: null,
      error: null,
    });
    syncDesktopWindowMode("main");
  },

  switchAccount: () => {
    cancelPendingRequests("用户切换账号");
    localStorage.removeItem("tescord_last_user");
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
