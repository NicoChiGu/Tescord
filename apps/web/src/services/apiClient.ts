import { useAuthStore } from "../stores/useAuthStore.js";

interface PendingRequest {
  url: RequestInfo | URL;
  init?: RequestInit;
  resolve: (value: Response | PromiseLike<Response>) => void;
  reject: (reason?: any) => void;
  userId: string | null;
}

let isRefreshing = false;
let refreshSubscribers: Array<(token: string | null) => void> = [];
const pendingReauthQueue: PendingRequest[] = [];

// 保留原生 fetch 引用
const originalFetch =
  typeof window !== "undefined" ? window.fetch.bind(window) : fetch;

/**
 * 唤醒所有等待静默刷新的并发请求
 */
function onRefreshed(token: string | null) {
  refreshSubscribers.forEach((cb) => cb(token));
  refreshSubscribers = [];
}

/**
 * 添加等待静默刷新的订阅者
 */
function subscribeTokenRefresh(cb: (token: string | null) => void) {
  refreshSubscribers.push(cb);
}

/**
 * 更新 RequestInit 中的 Authorization 请求头
 */
function cloneOptionsWithToken(
  init?: RequestInit,
  token?: string | null,
): RequestInit {
  const newInit: RequestInit = { ...(init || {}) };
  const headers = new Headers(newInit.headers || {});
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  } else {
    headers.delete("Authorization");
  }
  newInit.headers = headers;
  return newInit;
}

/**
 * 用户通过 ReauthModal 重新登录成功后，批量重放挂起的业务请求
 */
export function flushPendingRequests(newAccessToken: string) {
  while (pendingReauthQueue.length > 0) {
    const item = pendingReauthQueue.shift();
    if (!item) break;
    const updatedOptions = cloneOptionsWithToken(item.init, newAccessToken);
    if (item.userId !== useAuthStore.getState().user?.id) {
      item.reject(new Error("账号已切换，取消旧请求"));
      continue;
    }
    originalFetch(item.url, updatedOptions)
      .then((res) => item.resolve(res))
      .catch((err) => item.reject(err));
  }
}

/**
 * 用户切换账号或取消重新登录时，取消所有挂起的请求
 */
export function cancelPendingRequests(
  reason: string = "Session expired and canceled",
) {
  while (pendingReauthQueue.length > 0) {
    const item = pendingReauthQueue.shift();
    if (!item) break;
    item.reject(new Error(reason));
  }
}

/**
 * 智能 API Fetch 封装：支持双层防御（静默刷新 + 模态阻断重放队列）
 */
export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const urlStr =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : (input as Request).url;

  // 1. 若为鉴权接口本身（登录、注册、刷新、邮箱检查、注册状态），直接放行原生请求，防止循环拦截
  const isAuthEndpoint =
    urlStr.includes("/api/auth/login") ||
    urlStr.includes("/api/auth/register") ||
    urlStr.includes("/api/auth/refresh") ||
    urlStr.includes("/api/auth/logout") ||
    urlStr.includes("/api/auth/check-email") ||
    urlStr.includes("/api/auth/registration-status");

  if (isAuthEndpoint) {
    return originalFetch(input, init);
  }

  // 2. 正常发起请求
  let response: Response;
  try {
    response = await originalFetch(input, init);
  } catch (err) {
    throw err;
  }

  // 3. 非 401 响应直接返回
  if (response.status !== 401) {
    return response;
  }

  // 4. 若为 401 Unauthorized，启动双层拦截处理
  const authStore = useAuthStore.getState();

  // 若前端根本没有登录或无 refresh_token，直接返回 401 响应
  const refreshToken =
    authStore.refreshToken ||
    (typeof localStorage !== "undefined"
      ? localStorage.getItem("tescord_refresh_token")
      : null);

  if (!refreshToken) {
    // 唤起重登弹窗并排队
    authStore.openReauthModal("登录会话已过期，请重新登录");
    return new Promise<Response>((resolve, reject) => {
      pendingReauthQueue.push({
        url: input,
        init,
        resolve,
        reject,
        userId: authStore.user?.id || null,
      });
    });
  }

  // 5. 尝试静默刷新
  if (isRefreshing) {
    // 已经有其他请求在刷新中，加入等待订阅
    return new Promise<Response>((resolve, reject) => {
      subscribeTokenRefresh((newToken) => {
        if (newToken) {
          const updatedOptions = cloneOptionsWithToken(init, newToken);
          originalFetch(input, updatedOptions).then(resolve).catch(reject);
        } else {
          if (useAuthStore.getState().refreshFailure === "transient") {
            resolve(response);
            return;
          }
          // 刷新失败，转入重登挂起队列
          pendingReauthQueue.push({
            url: input,
            init,
            resolve,
            reject,
            userId: authStore.user?.id || null,
          });
        }
      });
    });
  }

  isRefreshing = true;

  try {
    const refreshed = await authStore.refreshAuth();
    if (refreshed) {
      const newToken = useAuthStore.getState().accessToken;
      isRefreshing = false;
      onRefreshed(newToken);

      // 用新 Token 重试当前请求
      const retryOptions = cloneOptionsWithToken(init, newToken);
      return originalFetch(input, retryOptions);
    } else {
      // Refresh Token 也失效了
      isRefreshing = false;
      onRefreshed(null);
      if (useAuthStore.getState().refreshFailure === "transient")
        return response;

      // 唤起毛玻璃重新登录弹窗，并挂起当前请求
      authStore.openReauthModal("登录凭据已完全失效，请输入密码重新验证");
      return new Promise<Response>((resolve, reject) => {
        pendingReauthQueue.push({
          url: input,
          init,
          resolve,
          reject,
          userId: authStore.user?.id || null,
        });
      });
    }
  } catch (e) {
    isRefreshing = false;
    onRefreshed(null);
    return response;
  }
}

let isInterceptorInstalled = false;

/**
 * 全局安装 Fetch 拦截器，使项目中所有现有直接使用 window.fetch 的地方无缝生效
 */
export function installFetchInterceptor() {
  if (isInterceptorInstalled || typeof window === "undefined") return;
  isInterceptorInstalled = true;
  window.fetch = apiFetch;
}
