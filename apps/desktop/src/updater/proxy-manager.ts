import https from "node:https";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { BUILD_CONFIG } from "../build-config.js";

interface SavedUpdaterSettings {
  customProxy?: string;
}

export class ProxyManager {
  private static instance: ProxyManager;
  private customProxy: string = "";
  private settingsFilePath: string;

  private constructor() {
    this.settingsFilePath = path.join(
      app.getPath("userData"),
      "updater-settings.json",
    );
    this.loadSettings();
  }

  public static getInstance(): ProxyManager {
    if (!ProxyManager.instance) {
      ProxyManager.instance = new ProxyManager();
    }
    return ProxyManager.instance;
  }

  private loadSettings(): void {
    try {
      if (fs.existsSync(this.settingsFilePath)) {
        const data = JSON.parse(
          fs.readFileSync(this.settingsFilePath, "utf-8"),
        ) as SavedUpdaterSettings;
        if (typeof data.customProxy === "string") {
          this.customProxy = data.customProxy.trim();
        }
      }
    } catch (err) {
      console.warn("⚠️ [ProxyManager] 加载代理设置失败，将采用默认策略:", err);
    }
  }

  private saveSettings(): void {
    try {
      const data: SavedUpdaterSettings = { customProxy: this.customProxy };
      fs.writeFileSync(
        this.settingsFilePath,
        JSON.stringify(data, null, 2),
        "utf-8",
      );
    } catch (err) {
      console.error("❌ [ProxyManager] 保存代理设置失败:", err);
    }
  }

  public getCustomProxy(): string {
    return this.customProxy;
  }

  public setCustomProxy(proxyUrl: string): void {
    const requested = (proxyUrl || "").trim();
    if (requested) {
      const parsed = new URL(requested);
      if (
        parsed.protocol !== "https:" ||
        parsed.username ||
        parsed.password ||
        parsed.search ||
        parsed.hash
      ) {
        throw new Error(
          "Update proxy must be an HTTPS URL without credentials or query parameters",
        );
      }
    }
    this.customProxy = requested;
    if (this.customProxy && !this.customProxy.endsWith("/")) {
      this.customProxy += "/";
    }
    this.saveSettings();
  }

  /**
   * 获取按优先级排序的候选代理前缀列表
   * 1. 用户自定义代理 (若配置)
   * 2. 首选 gh-proxy (https://v6.gh-proxy.org/)
   * 3. 备选 gh-proxy (https://gh-proxy.com/)
   * 4. 直连 (空字符串)
   */
  public getCandidateProxyPrefixes(): string[] {
    const list: string[] = [];
    if (this.customProxy) {
      list.push(this.customProxy);
    }
    list.push(BUILD_CONFIG.PRIMARY_GH_PROXY);
    list.push(BUILD_CONFIG.BACKUP_GH_PROXY);
    list.push(""); // 直连
    return Array.from(new Set(list));
  }

  /**
   * 将原始 GitHub 资源 URL 转换为代理后的 URL
   */
  public wrapUrl(rawUrl: string, proxyPrefix: string): string {
    if (!proxyPrefix) return rawUrl;
    const prefix = proxyPrefix.endsWith("/") ? proxyPrefix : `${proxyPrefix}/`;
    return `${prefix}${rawUrl}`;
  }

  /**
   * 探测指定 URL 是否可在 timeoutMs 毫秒内连通
   */
  public async probe(
    url: string,
    timeoutMs: number = 3000,
  ): Promise<{ ok: boolean; rtt: number }> {
    const start = Date.now();
    return new Promise((resolve) => {
      try {
        const parsed = new URL(url);
        const client = parsed.protocol === "https:" ? https : http;
        const req = client.request(
          url,
          {
            method: "HEAD",
            headers: {
              "User-Agent": "Tescord-Desktop-Updater/1.0",
            },
          },
          (res) => {
            const rtt = Date.now() - start;
            // 只要不是 502/504 等代理挂掉即可，404/200/302 都说明代理链路可通
            const ok = Boolean(res.statusCode && res.statusCode < 500);
            resolve({ ok, rtt });
          },
        );

        req.on("error", () => resolve({ ok: false, rtt: Date.now() - start }));
        req.setTimeout(timeoutMs, () => {
          req.destroy();
          resolve({ ok: false, rtt: Date.now() - start });
        });
        req.end();
      } catch {
        resolve({ ok: false, rtt: Date.now() - start });
      }
    });
  }

  /**
   * 阶梯降级请求：优先尝试 v6.gh-proxy.org，失败自动平滑回退 gh-proxy.com 和直连
   */
  public async fetchWithFallback(
    rawUrl: string,
    options: {
      timeoutMs?: number;
      headers?: Record<string, string>;
      maxBytes?: number;
    } = {},
  ): Promise<{ data: Buffer; usedProxy: string; contentType?: string }> {
    const proxies = this.getCandidateProxyPrefixes();
    let lastError: any = null;

    for (const proxy of proxies) {
      const targetUrl = this.wrapUrl(rawUrl, proxy);
      try {
        const buffer = await this.downloadBuffer(targetUrl, options);
        return {
          data: buffer.data,
          usedProxy: proxy,
          contentType: buffer.contentType,
        };
      } catch (err: any) {
        lastError = err;
        console.warn(
          `⚠️ [ProxyManager] 请求代理失败 [${proxy || "直连"}]: ${err.message}，自动尝试下一阶梯...`,
        );
      }
    }

    throw new Error(
      `所有加速代理及直连均尝试失败: ${lastError?.message || "未知错误"}`,
    );
  }

  private downloadBuffer(
    url: string,
    options: {
      timeoutMs?: number;
      headers?: Record<string, string>;
      maxBytes?: number;
    },
    redirects = 0,
  ): Promise<{ data: Buffer; contentType?: string }> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || redirects > 5) {
        reject(new Error("Unsafe updater URL or redirect chain"));
        return;
      }
      const client = parsed.protocol === "https:" ? https : http;
      const headers = {
        "User-Agent": "Tescord-Desktop-Updater/1.0",
        Accept: "*/*",
        ...(options.headers || {}),
      };

      const req = client.get(url, { headers }, (res) => {
        // 处理 301/302 重定向
        if (
          res.statusCode &&
          [301, 302, 307, 308].includes(res.statusCode) &&
          res.headers.location
        ) {
          res.resume();
          const redirectUrl = res.headers.location;
          this.downloadBuffer(
            new URL(redirectUrl, url).toString(),
            options,
            redirects + 1,
          )
            .then(resolve)
            .catch(reject);
          return;
        }

        if (!res.statusCode || res.statusCode >= 400) {
          return reject(
            new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`),
          );
        }

        const chunks: Buffer[] = [];
        let received = 0;
        res.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received > (options.maxBytes || 50 * 1024 * 1024)) {
            req.destroy(new Error("Updater response is too large"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          resolve({
            data: Buffer.concat(chunks),
            contentType: res.headers["content-type"],
          });
        });
      });

      const timeout = options.timeoutMs || 8000;
      req.setTimeout(timeout, () => {
        req.destroy();
        reject(new Error(`请求超时 (${timeout}ms)`));
      });
      req.on("error", (err) => reject(err));
    });
  }
}
