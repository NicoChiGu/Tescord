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
import {
  getStorageAdapter,
  waitForStorageMigration,
} from "../services/storage/index.js";
import { startAuthentication } from "@simplewebauthn/browser";
import { isWebAuthnSupported } from "../utils/webauthn.js";

const MAX_SAVED_ACCOUNTS = 10;
const SAVED_ACCOUNTS_STORAGE_KEY = "tescord_saved_accounts";
const REFRESH_KEY = "tescord_refresh_token";
const ACCESS_KEY = "tescord_access_token";
let authGeneration = 0;
let desktopAccountsCache: SavedAccount[] | null = null;
let desktopRememberActive = false;
let desktopAccountsWrite: Promise<void> = Promise.resolve();
let desktopMigrationSucceeded: boolean | null = null;

function isDesktopStorage(): boolean {
  return typeof window !== "undefined" && Boolean(window.electronAPI?.storage);
}

function currentRefreshToken(): string | null {
  return (
    sessionStorage.getItem(REFRESH_KEY) || localStorage.getItem(REFRESH_KEY)
  );
}

async function storeActiveTokens(
  tokens: AuthTokens,
  remember: boolean,
): Promise<void> {
  if (isDesktopStorage() && desktopMigrationSucceeded !== false) {
    desktopRememberActive = remember;
    sessionStorage.setItem(ACCESS_KEY, tokens.accessToken);
    sessionStorage.setItem(REFRESH_KEY, tokens.refreshToken);
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  } else if (remember) {
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

  // 同步写入 StorageAdapter (在桌面端通过 safeStorage 系统级加密入 SQLite)
  await getStorageAdapter().setActiveTokens(tokens, remember);
}

async function waitForDesktopAccountSave(): Promise<void> {
  if (isDesktopStorage() && desktopMigrationSucceeded !== false) {
    await desktopAccountsWrite;
  }
}

async function clearActiveTokens(): Promise<void> {
  desktopRememberActive = false;
  localStorage.removeItem(ACCESS_KEY);
  sessionStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  sessionStorage.removeItem(REFRESH_KEY);

  await getStorageAdapter().clearActiveTokens();
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
    if (isDesktopStorage() && desktopAccountsCache) return desktopAccountsCache;
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(SAVED_ACCOUNTS_STORAGE_KEY);
    if (raw) {
      const list = JSON.parse(raw);
      if (Array.isArray(list) && list.length > 0) {
        return isDesktopStorage() && desktopMigrationSucceeded !== false
          ? list.map((account: SavedAccount) => ({
              ...account,
              refreshToken: undefined,
            }))
          : list;
      }
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
        rememberPassword: Boolean(localStorage.getItem(REFRESH_KEY)),
        refreshToken:
          isDesktopStorage() && desktopMigrationSucceeded !== false
            ? undefined
            : localStorage.getItem("tescord_refresh_token") || undefined,
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
    const limited = accounts.slice(0, MAX_SAVED_ACCOUNTS);
    if (isDesktopStorage() && desktopMigrationSucceeded !== false)
      desktopAccountsCache = limited;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(
        SAVED_ACCOUNTS_STORAGE_KEY,
        JSON.stringify(
          isDesktopStorage() && desktopMigrationSucceeded !== false
            ? limited.map(
                ({ refreshToken: _refreshToken, ...account }) => account,
              )
            : limited,
        ),
      );
    }
    // 同步到 StorageAdapter (SQLite safeStorage)
    if (isDesktopStorage() && desktopMigrationSucceeded !== false) {
      desktopAccountsWrite = desktopAccountsWrite
        .catch(() => {})
        .then(() => getStorageAdapter().saveSavedAccounts(limited))
        .catch((err) =>
          console.warn(
            "[useAuthStore] Adapter saveSavedAccounts warning:",
            err,
          ),
        );
    } else {
      getStorageAdapter()
        .saveSavedAccounts(limited)
        .catch((err) =>
          console.warn(
            "[useAuthStore] Adapter saveSavedAccounts warning:",
            err,
          ),
        );
    }
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
  loginWithPasskey: (emailOrUsername?: string) => Promise<void>;
  register: (dto: RegisterDTO) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: User | null) => void;
  updateProfile: (dto: UpdateProfileDTO) => Promise<void>;
  refreshAuth: () => Promise<boolean>;
  getAuthHeaders: () => Record<string, string>;
  openReauthModal: (reason?: string) => void;
  closeReauthModal: () => void;
  reauth: (password: string) => Promise<void>;
  switchAccount: () => Promise<void>;
  removeSavedAccount: (idOrEmail: string) => void;
  loginWithSavedAccount: (account: SavedAccount) => Promise<boolean>;
}

const syncDesktopWindowMode = (mode: "auth" | "main") => {
  if (typeof window !== "undefined" && window.electronAPI) {
    if (window.electronAPI.setWindowMode) {
      window.electronAPI.setWindowMode(mode).catch(() => {});
    } else if (mode === "main") {
      window.electronAPI.notifyAuthSuccess?.().catch(() => {});
    } else {
      window.electronAPI.notifyLogout?.().catch(() => {});
    }
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
    try {
      if (isDesktopStorage()) {
        desktopMigrationSucceeded = await waitForStorageMigration();
      }
      let accounts = getStoredSavedAccounts();
      let nativeActive: Awaited<
        ReturnType<ReturnType<typeof getStorageAdapter>["getActiveTokens"]>
      > = null;
      if (isDesktopStorage() && desktopMigrationSucceeded) {
        try {
          const nativeAccounts = await getStorageAdapter().getSavedAccounts();
          if (nativeAccounts && nativeAccounts.length > 0) {
            accounts = nativeAccounts;
          }
          desktopAccountsCache = accounts;
          nativeActive = await getStorageAdapter().getActiveTokens();
          desktopRememberActive = Boolean(nativeActive?.remember);
        } catch {}
      }
      set({ savedAccounts: accounts });

      let accessToken =
        sessionStorage.getItem(ACCESS_KEY) || localStorage.getItem(ACCESS_KEY);
      let refreshToken = currentRefreshToken();

      if (isDesktopStorage() && desktopMigrationSucceeded) {
        // Migration has completed before adapter reads resolve. Remove the old
        // renderer plaintext copies while retaining this window's session.
        if (accessToken) sessionStorage.setItem(ACCESS_KEY, accessToken);
        if (refreshToken) sessionStorage.setItem(REFRESH_KEY, refreshToken);
        localStorage.removeItem(ACCESS_KEY);
        localStorage.removeItem(REFRESH_KEY);
        localStorage.setItem(
          SAVED_ACCOUNTS_STORAGE_KEY,
          JSON.stringify(
            accounts.map(
              ({ refreshToken: _refreshToken, ...account }) => account,
            ),
          ),
        );
      }

      // 如果浏览器缓存被清除，尝试从桌面端 safeStorage + SQLite 恢复活跃会话
      if (
        !accessToken &&
        !refreshToken &&
        typeof window !== "undefined" &&
        window.electronAPI?.storage
      ) {
        try {
          const active = nativeActive;
          if (active && (active.accessToken || active.refreshToken)) {
            accessToken = active.accessToken;
            refreshToken = active.refreshToken;
            await storeActiveTokens(
              {
                accessToken: active.accessToken,
                refreshToken: active.refreshToken,
                user: active.user,
                expiresIn: 3600,
              },
              active.remember,
            );
          }
        } catch {}
      }

      // 1. 优先尝试本地活跃的 access/refresh token
      if (accessToken || refreshToken) {
        try {
          if (accessToken) {
            const res = await fetch(`${API_BASE}/api/auth/me`, {
              headers: { Authorization: `Bearer ${accessToken}` },
            });

            if (res.ok) {
              const user: User = await res.json();
              await getStorageAdapter().switchUser(user.id);
              localStorage.setItem("tescord_last_user", JSON.stringify(user));
              const remember =
                isDesktopStorage() && desktopMigrationSucceeded
                  ? desktopRememberActive
                  : Boolean(localStorage.getItem(REFRESH_KEY));
              const updated = upsertSavedAccount(
                user,
                { refreshToken: refreshToken || undefined },
                remember,
              );
              await waitForDesktopAccountSave();
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
      cancelPendingRequests("会话未授权或已失效");
      if (get().refreshFailure !== "transient")
        await clearActiveTokens().catch(() => {});
      set({
        user: null,
        accessToken: null,
        token: null,
        refreshToken: null,
        isAuthenticated: false,
        isLoading: false,
      });
      syncDesktopWindowMode("auth");
    } catch {
      clearProactiveRefreshTimer();
      cancelPendingRequests("初始化认证失败");
      await clearActiveTokens().catch(() => {});
      set({
        user: null,
        accessToken: null,
        token: null,
        refreshToken: null,
        isAuthenticated: false,
        isLoading: false,
      });
      syncDesktopWindowMode("auth");
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
      await getStorageAdapter().switchUser(tokens.user.id);
      authGeneration++;
      await storeActiveTokens(tokens, rememberMe);

      const updatedAccounts = upsertSavedAccount(
        tokens.user,
        { refreshToken: tokens.refreshToken },
        rememberMe,
      );
      await waitForDesktopAccountSave();

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

  loginWithPasskey: async (emailOrUsername?: string) => {
    set({ error: null });
    if (!isWebAuthnSupported()) {
      const err = new Error("当前环境或浏览器不支持通行密钥登录");
      set({ error: err.message });
      throw err;
    }

    try {
      // 1. 获取登录挑战选项
      const optionsRes = await fetch(
        `${API_BASE}/api/auth/webauthn/login-options`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ emailOrUsername }),
        },
      );

      const optionsData = await optionsRes.json();
      if (!optionsRes.ok) {
        throw new Error(optionsData.error || "获取通行密钥配置失败");
      }

      const { options, challengeId } = optionsData;

      // 2. 拉起原生系统认证器 (Touch ID / Windows Hello / 安全密钥)
      const authResponse = await startAuthentication({ optionsJSON: options });

      // 3. 将认证凭据发送至服务端核验
      const verifyRes = await fetch(
        `${API_BASE}/api/auth/webauthn/login-verify`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            challengeId,
            response: authResponse,
          }),
        },
      );

      const data = await verifyRes.json();
      if (!verifyRes.ok) {
        throw new Error(data.error || "通行密钥验证失败");
      }

      // 4. 写入会话状态与双令牌
      const tokens = data as AuthTokens;
      const rememberMe = true;
      await getStorageAdapter().switchUser(tokens.user.id);
      authGeneration++;
      await storeActiveTokens(tokens, rememberMe);

      const updatedAccounts = upsertSavedAccount(
        tokens.user,
        { refreshToken: tokens.refreshToken },
        rememberMe,
      );
      await waitForDesktopAccountSave();

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
      if (err.name === "NotAllowedError") {
        set({ error: "已取消通行密钥验证" });
      } else {
        set({ error: err.message || "通行密钥登录失败" });
      }
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
      await getStorageAdapter().switchUser(tokens.user.id);
      authGeneration++;
      await storeActiveTokens(tokens, true);

      const updatedAccounts = upsertSavedAccount(
        tokens.user,
        { refreshToken: tokens.refreshToken },
        true,
      );
      await waitForDesktopAccountSave();

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
          await getStorageAdapter().switchUser(data.user.id);
          authGeneration++;
          await storeActiveTokens(data, true);

          const updated = upsertSavedAccount(
            data.user,
            { refreshToken: data.refreshToken },
            true,
          );
          await waitForDesktopAccountSave();

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
          const adoptSharedRotation = async (
            staleToken: string | null,
          ): Promise<boolean> => {
            const rotatedToken = currentRefreshToken();
            const newerAccess = localStorage.getItem(ACCESS_KEY);
            if (
              !rotatedToken ||
              rotatedToken === staleToken ||
              accessExpiresAt(newerAccess) <= Date.now() + 60_000 ||
              generation !== authGeneration
            )
              return false;
            const identity = await fetch(`${API_BASE}/api/auth/me`, {
              headers: { Authorization: `Bearer ${newerAccess}` },
            });
            if (!identity.ok) return false;
            const user = (await identity.json()) as User;
            if (expectedUserId && user.id !== expectedUserId) return false;
            await getStorageAdapter().switchUser(user.id);
            set({
              user,
              lastActiveUser: user,
              isAuthenticated: true,
              accessToken: newerAccess,
              token: newerAccess,
              refreshToken: rotatedToken,
              refreshFailure: null,
            });
            scheduleProactiveRefresh(() => get().refreshAuth(), newerAccess);
            return true;
          };
          // Another tab may have rotated the token while this tab waited for the lock.
          if (await adoptSharedRotation(startedRefreshToken)) {
            return true;
          }
          const res = await fetch(`${API_BASE}/api/auth/refresh`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refreshToken }),
          });
          if (!res.ok) {
            // A sibling tab may have committed a successful rotation while
            // this request was in flight. Recheck before treating 401 as loss.
            if (await adoptSharedRotation(refreshToken)) return true;
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
          await getStorageAdapter().switchUser(data.user.id);
          const remembered =
            isDesktopStorage() && desktopMigrationSucceeded
              ? desktopRememberActive
              : Boolean(localStorage.getItem(REFRESH_KEY));
          await storeActiveTokens(data, remembered);

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
                rememberPassword: remembered,
                refreshToken: remembered ? data.refreshToken : undefined,
                lastActiveAt: Date.now(),
                avatarUrl: data.user.avatarUrl ?? acc.avatarUrl,
                displayName: data.user.displayName ?? acc.displayName,
                username: data.user.username ?? acc.username,
              };
            }
            return acc;
          });
          if (!updated.some((account) => account.id === data.user.id)) {
            updated.unshift({
              id: data.user.id,
              email: data.user.email,
              username: data.user.username,
              displayName: data.user.displayName,
              discriminator: data.user.discriminator,
              avatarUrl: data.user.avatarUrl,
              lastActiveAt: Date.now(),
              rememberPassword: remembered,
              refreshToken: remembered ? data.refreshToken : undefined,
            });
          }
          persistSavedAccounts(updated);
          await waitForDesktopAccountSave();

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

  logout: async () => {
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

    await waitForDesktopAccountSave();
    await clearActiveTokens();
    await getStorageAdapter().switchUser(null);
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
    await getStorageAdapter().switchUser(tokens.user.id);
    authGeneration++;
    await storeActiveTokens(
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
    await waitForDesktopAccountSave();

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

  switchAccount: async () => {
    authGeneration++;
    clearProactiveRefreshTimer();
    cancelPendingRequests("用户切换账号");
    await clearActiveTokens();
    await getStorageAdapter().switchUser(null);
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
