import { create } from "zustand";
import {
  User,
  LoginDTO,
  RegisterDTO,
  UpdateProfileDTO,
  AuthTokens,
} from "@tescord/types";
import { API_BASE } from "../config.js";

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  initAuth: () => Promise<void>;
  login: (dto: LoginDTO) => Promise<void>;
  register: (dto: RegisterDTO) => Promise<void>;
  logout: () => void;
  updateProfile: (dto: UpdateProfileDTO) => Promise<void>;
  refreshAuth: () => Promise<boolean>;
  getAuthHeaders: () => Record<string, string>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  accessToken: localStorage.getItem("tescord_access_token"),
  refreshToken: localStorage.getItem("tescord_refresh_token"),
  token: localStorage.getItem("tescord_access_token"),
  isAuthenticated: false,
  isLoading: true,
  error: null,

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
          set({
            user,
            accessToken,
            token: accessToken,
            refreshToken,
            isAuthenticated: true,
            isLoading: false,
          });
          return;
        }
      }

      // 2. Access Token 失效，尝试使用 Refresh Token 无感静默刷新
      if (refreshToken) {
        const refreshed = await get().refreshAuth();
        if (refreshed) {
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
    set({ isLoading: true, error: null });
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

      set({
        user: tokens.user,
        accessToken: tokens.accessToken,
        token: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
      throw err;
    }
  },

  register: async (dto: RegisterDTO) => {
    set({ isLoading: true, error: null });
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

      set({
        user: tokens.user,
        accessToken: tokens.accessToken,
        token: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
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

      set({
        user: data.user,
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
      error: null,
    });
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
