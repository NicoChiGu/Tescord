import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { Activity } from "@tescord/types";

const execAsync = promisify(exec);

interface GameRule {
  executables: string[]; // 小写进程名
  name: string;
  details?: string;
}

// 常见 Steam 游戏 AppID 中文美化名称字典
const STEAM_KNOWN_NAMES: Record<string, string> = {
  "413150": "星露谷物语 (Stardew Valley)",
  "730": "Counter-Strike 2",
  "570": "Dota 2",
  "1172470": "Apex Legends",
  "1245620": "艾尔登法环 (ELDEN RING)",
  "2358720": "黑神话：悟空 (Black Myth: Wukong)",
  "1091500": "赛博朋克 2077 (Cyberpunk 2077)",
  "271590": "Grand Theft Auto V",
  "578080": "绝地求生 (PUBG: BATTLEGROUNDS)",
  "1203220": "永劫无间 (NARAKA: BLADEPOINT)",
  "1086940": "博德之门 3 (Baldur's Gate 3)",
  "814380": "只狼：影逝二度 (Sekiro: Shadows Die Twice)",
  "105600": "泰拉瑞亚 (Terraria)",
  "892970": "英灵神殿 (Valheim)",
  "945360": "Among Us",
  "367520": "空洞骑士 (Hollow Knight)",
  "1145360": "黑帝斯 (Hades)",
  "1145350": "黑帝斯 2 (Hades II)",
  "1966720": "致命公司 (Lethal Company)",
  "1623730": "幻兽帕鲁 (Palworld)",
  "2246340": "怪物猎人：荒野 (Monster Hunter Wilds)",
  "582010": "怪物猎人：世界 (Monster Hunter: World)",
  "252490": "Rust",
  "440": "Team Fortress 2",
  "289070": "文明 6 (Civilization VI)",
  "1551360": "极限竞速：地平线 5 (Forza Horizon 5)",
  "553850": "绝地潜兵 2 (HELLDIVERS™ 2)",
  "292030": "巫师 3：狂猎 (The Witcher 3: Wild Hunt)",
  "2050650": "生化危机 4 重制版 (Resident Evil 4)",
  "2861690": "小丑牌 (Balatro)",
  "1794680": "吸血鬼幸存者 (Vampire Survivors)",
  "646570": "杀戮尖塔 (Slay the Spire)",
};

// 常见独立或非 Steam 热门游戏特征字典
const KNOWN_GAMES: GameRule[] = [
  {
    executables: [
      "stardew valley.exe",
      "stardewvalley.exe",
      "stardewmoddingapi.exe",
    ],
    name: "星露谷物语 (Stardew Valley)",
  },
  {
    executables: ["leagueclientux.exe", "league of legends.exe"],
    name: "英雄联盟 (League of Legends)",
  },
  {
    executables: ["yuanshen.exe", "genshinimpact.exe"],
    name: "原神 (Genshin Impact)",
  },
  {
    executables: ["starrail.exe"],
    name: "崩坏：星穹铁道 (Honkai: Star Rail)",
  },
  {
    executables: ["b1.exe", "b1-win64-shipping.exe", "blackmythwukong.exe"],
    name: "黑神话：悟空 (Black Myth: Wukong)",
  },
  {
    executables: ["cs2.exe", "csgo.exe"],
    name: "Counter-Strike 2",
  },
  {
    executables: ["valorant.exe", "valorant-win64-shipping.exe"],
    name: "无畏契约 (VALORANT)",
  },
  {
    executables: ["minecraft.exe", "minecraft.windows.exe"],
    name: "Minecraft",
  },
  {
    executables: ["dota2.exe"],
    name: "Dota 2",
  },
  {
    executables: ["r5apex.exe"],
    name: "Apex Legends",
  },
  {
    executables: ["naraka.exe", "naraka_steam.exe"],
    name: "永劫无间 (NARAKA: BLADEPOINT)",
  },
  {
    executables: ["overwatch.exe"],
    name: "守望先锋 (Overwatch 2)",
  },
  {
    executables: ["eldenring.exe"],
    name: "艾尔登法环 (ELDEN RING)",
  },
  {
    executables: ["cyberpunk2077.exe"],
    name: "赛博朋克 2077 (Cyberpunk 2077)",
  },
  {
    executables: ["gta5.exe", "playgtav.exe"],
    name: "Grand Theft Auto V",
  },
  {
    executables: ["tslgame.exe", "pubg.exe"],
    name: "绝地求生 (PUBG: BATTLEGROUNDS)",
  },
  {
    executables: ["crossfire.exe"],
    name: "穿越火线 (CrossFire)",
  },
  {
    executables: ["wutheringwaves.exe", "client-win64-shipping.exe"],
    name: "鸣潮 (Wuthering Waves)",
  },
  {
    executables: ["zenlesszonezero.exe"],
    name: "绝区零 (Zenless Zone Zero)",
  },
];

export class GameDetector {
  private isEnabled = true;
  private timer: NodeJS.Timeout | null = null;
  private currentActivity: Activity | null = null;
  private currentGameStartTime = 0;
  private currentIdentifier: string | null = null; // 标识当前游戏 (steam:appid 或 exe:name)
  private onActivityChangeCallbacks: Array<
    (activity: Activity | null) => void
  > = [];

  // Steam 路径与库目录缓存
  private cachedSteamPath: string | null = null;
  private cachedLibraryFolders: string[] = [];
  private lastSteamPathCheckTime = 0;

  constructor() {
    this.startPolling();
  }

  public setEnabled(enabled: boolean) {
    this.isEnabled = enabled;
    if (!enabled && this.currentActivity) {
      this.currentActivity = null;
      this.currentIdentifier = null;
      this.notifyChange(null);
    }
  }

  public isDetectionEnabled(): boolean {
    return this.isEnabled;
  }

  public getCurrentActivity(): Activity | null {
    if (!this.isEnabled) return null;
    return this.currentActivity;
  }

  public onActivityChange(
    callback: (activity: Activity | null) => void,
  ): () => void {
    this.onActivityChangeCallbacks.push(callback);
    return () => {
      this.onActivityChangeCallbacks = this.onActivityChangeCallbacks.filter(
        (cb) => cb !== callback,
      );
    };
  }

  private notifyChange(activity: Activity | null) {
    for (const cb of this.onActivityChangeCallbacks) {
      try {
        cb(activity);
      } catch (err) {
        console.error("[GameDetector] callback error:", err);
      }
    }
  }

  public startPolling(intervalMs = 3000) {
    if (this.timer) {
      clearInterval(this.timer);
    }
    // 首次立即探测一次
    this.scan();
    this.timer = setInterval(() => {
      this.scan();
    }, intervalMs);
  }

  public stopPolling() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * 优先侦测 Steam 当前运行的游戏
   */
  private async detectSteamGame(): Promise<Activity | null> {
    if (process.platform !== "win32") {
      return null;
    }

    try {
      // 1. 毫秒级查询 Steam 官方维护的运行中 AppID
      const { stdout } = await execAsync(
        'reg query "HKCU\\Software\\Valve\\Steam" /v RunningAppID',
        { windowsHide: true, timeout: 2000 },
      );
      const match = stdout.match(/RunningAppID\s+REG_DWORD\s+0x([0-9a-fA-F]+)/);
      if (!match || !match[1]) {
        return null;
      }

      const appId = parseInt(match[1], 16);
      if (!appId || appId <= 0) {
        return null;
      }

      const appIdStr = String(appId);

      // 2. 解析游戏规范名称
      let gameName = STEAM_KNOWN_NAMES[appIdStr];
      if (!gameName) {
        // 从本地 Steam 库 acf 文件中提取真实游戏名
        const resolvedName = await this.resolveSteamNameFromAcf(appIdStr);
        gameName = resolvedName || `Steam 游戏 (${appIdStr})`;
      }

      return {
        name: gameName,
        type: "PLAYING",
        details: "Steam",
        applicationId: appIdStr,
        timestamps: {
          start: this.currentGameStartTime || Date.now(),
        },
        assets: {
          largeImage: `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appIdStr}/header.jpg`,
          largeText: gameName,
          smallImage: "steam",
          smallText: "Steam",
        },
      };
    } catch {
      return null;
    }
  }

  /**
   * 从 Steam 本地库目录的 appmanifest 中解析游戏名称
   */
  private async resolveSteamNameFromAcf(appId: string): Promise<string | null> {
    try {
      const now = Date.now();
      // 缓存 SteamPath 与库目录 10 分钟
      if (!this.cachedSteamPath || now - this.lastSteamPathCheckTime > 600000) {
        const { stdout } = await execAsync(
          'reg query "HKCU\\Software\\Valve\\Steam" /v SteamPath',
          { windowsHide: true, timeout: 2000 },
        );
        const match = stdout.match(/SteamPath\s+REG_SZ\s+(.+)/);
        if (match && match[1]) {
          this.cachedSteamPath = match[1].trim();
          this.cachedLibraryFolders = [this.cachedSteamPath];

          // 解析 libraryfolders.vdf
          const vdfPath = path.join(
            this.cachedSteamPath,
            "steamapps",
            "libraryfolders.vdf",
          );
          if (fs.existsSync(vdfPath)) {
            const vdfContent = fs.readFileSync(vdfPath, "utf-8");
            const pathMatches = vdfContent.matchAll(/"path"\s+"([^"]+)"/g);
            for (const m of pathMatches) {
              if (m[1]) {
                const libPath = m[1].replace(/\\\\/g, "\\");
                if (!this.cachedLibraryFolders.includes(libPath)) {
                  this.cachedLibraryFolders.push(libPath);
                }
              }
            }
          }
        }
        this.lastSteamPathCheckTime = now;
      }

      // 在所有库中查找 appmanifest_<appid>.acf
      for (const libDir of this.cachedLibraryFolders) {
        const acfPath = path.join(
          libDir,
          "steamapps",
          `appmanifest_${appId}.acf`,
        );
        if (fs.existsSync(acfPath)) {
          const acfContent = fs.readFileSync(acfPath, "utf-8");
          const nameMatch = acfContent.match(/"name"\s+"([^"]+)"/);
          if (nameMatch && nameMatch[1]) {
            return nameMatch[1];
          }
        }
      }
    } catch {
      // ignore
    }
    return null;
  }

  /**
   * 执行一次系统进程与 Steam 游戏快照扫描
   */
  public async scan(): Promise<Activity | null> {
    if (!this.isEnabled) {
      if (this.currentActivity !== null) {
        this.currentActivity = null;
        this.currentIdentifier = null;
        this.notifyChange(null);
      }
      return null;
    }

    try {
      // 1. 最高优先级：原生探测 Steam 官方正在运行的游戏
      const steamActivity = await this.detectSteamGame();
      if (steamActivity) {
        const identifier = `steam:${steamActivity.applicationId}`;
        if (this.currentIdentifier !== identifier) {
          this.currentIdentifier = identifier;
          this.currentGameStartTime = Date.now();
          steamActivity.timestamps = { start: this.currentGameStartTime };
          this.currentActivity = steamActivity;
          this.notifyChange(this.currentActivity);
        }
        return this.currentActivity;
      }

      // 2. 次优先级：非 Steam 独立进程扫描
      const runningExecutables = await this.getRunningProcesses();
      const detectedRule = KNOWN_GAMES.find((rule) =>
        rule.executables.some((exe) => runningExecutables.has(exe)),
      );

      if (detectedRule) {
        const matchedExe = detectedRule.executables.find((exe) =>
          runningExecutables.has(exe),
        )!;
        const identifier = `exe:${matchedExe}`;

        if (this.currentIdentifier !== identifier) {
          this.currentIdentifier = identifier;
          this.currentGameStartTime = Date.now();
          this.currentActivity = {
            name: detectedRule.name,
            type: "PLAYING",
            details: detectedRule.details || "正在游戏中",
            timestamps: {
              start: this.currentGameStartTime,
            },
          };
          this.notifyChange(this.currentActivity);
        }
        return this.currentActivity;
      }

      // 3. 既没有 Steam 游戏，也没有独立游戏运行
      if (this.currentActivity !== null) {
        this.currentActivity = null;
        this.currentIdentifier = null;
        this.notifyChange(null);
      }
    } catch {
      // 容错忽略单个周期的扫描错误
    }

    return this.currentActivity;
  }

  private async getRunningProcesses(): Promise<Set<string>> {
    const processSet = new Set<string>();

    if (process.platform === "win32") {
      try {
        const { stdout } = await execAsync("tasklist /fo csv /nh", {
          windowsHide: true,
          timeout: 3000,
        });
        const lines = stdout.split(/\r?\n/);
        for (const line of lines) {
          if (!line.trim()) continue;
          const firstCol = line
            .split(",")[0]
            ?.replace(/^"|"$/g, "")
            .trim()
            .toLowerCase();
          if (firstCol) {
            processSet.add(firstCol);
          }
        }
      } catch {
        // ignore
      }
    } else {
      try {
        const { stdout } = await execAsync("ps -A -o comm=", {
          timeout: 3000,
        });
        const lines = stdout.split(/\r?\n/);
        for (const line of lines) {
          const trimmed = line.trim().toLowerCase();
          if (trimmed) {
            processSet.add(trimmed);
          }
        }
      } catch {
        // ignore
      }
    }

    return processSet;
  }
}

export const gameDetector = new GameDetector();
