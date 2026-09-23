import { exec } from "child_process";
import { promisify } from "util";
import { Activity } from "@tescord/types";

const execAsync = promisify(exec);

interface GameRule {
  executables: string[]; // 小写进程名
  name: string;
  details?: string;
}

// 常见热门游戏特征字典
const KNOWN_GAMES: GameRule[] = [
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
  private currentExecutable: string | null = null;
  private onActivityChangeCallbacks: Array<(activity: Activity | null) => void> = [];

  constructor() {
    this.startPolling();
  }

  public setEnabled(enabled: boolean) {
    this.isEnabled = enabled;
    if (!enabled && this.currentActivity) {
      this.currentActivity = null;
      this.currentExecutable = null;
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

  public onActivityChange(callback: (activity: Activity | null) => void): () => void {
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

  public startPolling(intervalMs = 5000) {
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
   * 执行一次系统进程快照扫描
   */
  public async scan(): Promise<Activity | null> {
    if (!this.isEnabled) {
      if (this.currentActivity !== null) {
        this.currentActivity = null;
        this.currentExecutable = null;
        this.notifyChange(null);
      }
      return null;
    }

    try {
      const runningExecutables = await this.getRunningProcesses();
      const detectedRule = KNOWN_GAMES.find((rule) =>
        rule.executables.some((exe) => runningExecutables.has(exe)),
      );

      if (detectedRule) {
        const matchedExe = detectedRule.executables.find((exe) =>
          runningExecutables.has(exe),
        )!;

        // 如果是新游戏或首次启动
        if (this.currentExecutable !== matchedExe) {
          this.currentExecutable = matchedExe;
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
      } else {
        // 未检测到匹配游戏
        if (this.currentActivity !== null) {
          this.currentActivity = null;
          this.currentExecutable = null;
          this.notifyChange(null);
        }
      }
    } catch (err) {
      // 容错忽略单个周期的扫描错误
    }

    return this.currentActivity;
  }

  private async getRunningProcesses(): Promise<Set<string>> {
    const processSet = new Set<string>();

    if (process.platform === "win32") {
      try {
        // 使用 Windows 内置的标准轻量工具 tasklist
        const { stdout } = await execAsync("tasklist /fo csv /nh", {
          windowsHide: true,
          timeout: 4000,
        });
        const lines = stdout.split(/\r?\n/);
        for (const line of lines) {
          if (!line.trim()) continue;
          // CSV 第一列为映像名称，如 "cs2.exe"
          const firstCol = line.split(",")[0]?.replace(/^"|"$/g, "").trim().toLowerCase();
          if (firstCol) {
            processSet.add(firstCol);
          }
        }
      } catch {
        // 容错处理
      }
    } else {
      try {
        const { stdout } = await execAsync("ps -A -o comm=", {
          timeout: 4000,
        });
        const lines = stdout.split(/\r?\n/);
        for (const line of lines) {
          const trimmed = line.trim().toLowerCase();
          if (trimmed) {
            processSet.add(trimmed);
          }
        }
      } catch {
        // 容错处理
      }
    }

    return processSet;
  }
}

export const gameDetector = new GameDetector();
