import { create } from "zustand";
import { CustomEmoji } from "@tescord/types";
import { API_BASE, resolveServerUrl } from "../config.js";
import { useAuthStore } from "./useAuthStore.js";

const RECENT_EMOJIS_STORAGE_KEY = "tescord:recent_emojis";
const MAX_RECENT_EMOJIS = 24;

interface EmojiState {
  guildEmojis: Record<string, CustomEmoji[]>;
  userEmojis: CustomEmoji[];
  recentEmojis: string[];
  isLoading: boolean;
  error: string | null;

  fetchGuildEmojis: (guildId: string) => Promise<CustomEmoji[]>;
  fetchUserEmojis: () => Promise<CustomEmoji[]>;
  addRecentEmoji: (emoji: string) => void;
  uploadGuildEmoji: (
    guildId: string,
    name: string,
    file: File,
  ) => Promise<CustomEmoji>;
  uploadUserEmoji: (name: string, file: File) => Promise<CustomEmoji>;
  deleteGuildEmoji: (guildId: string, emojiId: string) => Promise<void>;
  deleteUserEmoji: (emojiId: string) => Promise<void>;
}

// 辅助：从 localStorage 读取常用表情
function loadInitialRecentEmojis(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_EMOJIS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.slice(0, MAX_RECENT_EMOJIS);
    }
  } catch {}
  return [
    "👍",
    "❤️",
    "😂",
    "🔥",
    "🎉",
    "🚀",
    "👀",
    "💯",
    "🤔",
    "🥳",
    "✨",
    "🙌",
  ];
}

// 辅助：静态图片尺寸与质量压缩 (Canvas，保持比例在 128x128 以内)
async function processEmojiImage(
  file: File,
): Promise<{ blob: Blob; mimeType: string; isAnimated: boolean }> {
  const isGif =
    file.type === "image/gif" || file.name.toLowerCase().endsWith(".gif");
  if (isGif) {
    if (file.size > 2 * 1024 * 1024) {
      throw new Error("GIF 表情文件大小不能超过 2MB");
    }
    return { blob: file, mimeType: "image/gif", isAnimated: true };
  }

  // 静态图片处理
  if (file.size > 5 * 1024 * 1024) {
    throw new Error("图片大小不能超过 5MB");
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const maxDim = 128;
      let width = img.naturalWidth || img.width;
      let height = img.naturalHeight || img.height;

      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, width);
      canvas.height = Math.max(1, height);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return resolve({
          blob: file,
          mimeType: file.type || "image/png",
          isAnimated: false,
        });
      }

      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          if (blob && blob.size > 0) {
            resolve({
              blob,
              mimeType: blob.type || "image/png",
              isAnimated: false,
            });
          } else {
            resolve({
              blob: file,
              mimeType: file.type || "image/png",
              isAnimated: false,
            });
          }
        },
        "image/png",
        0.9,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("图片加载失败，请确保格式有效"));
    };
    img.src = objectUrl;
  });
}

export const useEmojiStore = create<EmojiState>((set, get) => ({
  guildEmojis: {},
  userEmojis: [],
  recentEmojis: loadInitialRecentEmojis(),
  isLoading: false,
  error: null,

  fetchGuildEmojis: async (guildId: string) => {
    const { token } = useAuthStore.getState();
    if (!token || !guildId) return [];
    try {
      const res = await fetch(`${API_BASE}/api/guilds/${guildId}/emojis`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return [];
      const emojis: CustomEmoji[] = await res.json();
      set((state) => ({
        guildEmojis: {
          ...state.guildEmojis,
          [guildId]: emojis,
        },
      }));
      return emojis;
    } catch (e) {
      console.error("fetchGuildEmojis error:", e);
      return [];
    }
  },

  fetchUserEmojis: async () => {
    const { token } = useAuthStore.getState();
    if (!token) return [];
    try {
      const res = await fetch(`${API_BASE}/api/users/me/emojis`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return [];
      const emojis: CustomEmoji[] = await res.json();
      set({ userEmojis: emojis });
      return emojis;
    } catch (e) {
      console.error("fetchUserEmojis error:", e);
      return [];
    }
  },

  addRecentEmoji: (emoji: string) => {
    set((state) => {
      const filtered = state.recentEmojis.filter((e) => e !== emoji);
      const nextRecent = [emoji, ...filtered].slice(0, MAX_RECENT_EMOJIS);
      try {
        localStorage.setItem(
          RECENT_EMOJIS_STORAGE_KEY,
          JSON.stringify(nextRecent),
        );
      } catch {}
      return { recentEmojis: nextRecent };
    });
  },

  uploadGuildEmoji: async (guildId: string, name: string, file: File) => {
    const { token } = useAuthStore.getState();
    if (!token) throw new Error("未登录");

    const trimmedName = name.trim();
    if (!/^[a-zA-Z0-9_]{2,32}$/.test(trimmedName)) {
      throw new Error("表情名称必须为 2-32 位字母、数字或下划线");
    }

    const { blob, mimeType, isAnimated } = await processEmojiImage(file);
    const extension = isAnimated ? "gif" : "png";
    const filename = `${trimmedName}.${extension}`;

    // 1. 获取预签名上传链接
    const presignRes = await fetch(
      `${API_BASE}/api/attachments/presigned-url`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          fileName: filename,
          fileSize: blob.size,
          mimeType,
          purpose: "custom-emoji",
          guildId,
        }),
      },
    );

    if (!presignRes.ok) {
      const err = await presignRes.json().catch(() => ({}));
      throw new Error(err.error || "获取表情上传链接失败");
    }

    const { uploadUrl, fileUrl, requiresAuth } = await presignRes.json();

    // 2. 直传文件
    const uploadTarget = resolveServerUrl(uploadUrl);
    const uploadRes = await fetch(uploadTarget, {
      method: "PUT",
      headers: {
        "Content-Type": mimeType,
        ...(requiresAuth ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: blob,
    });

    if (!uploadRes.ok) {
      throw new Error("上传表情图片数据失败");
    }

    // 3. 登记表情
    const createRes = await fetch(`${API_BASE}/api/guilds/${guildId}/emojis`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        name: trimmedName,
        imageUrl: fileUrl,
        animated: isAnimated,
      }),
    });

    if (!createRes.ok) {
      const err = await createRes.json().catch(() => ({}));
      throw new Error(err.error || "创建服务器表情失败");
    }

    const createdEmoji: CustomEmoji = await createRes.json();
    set((state) => ({
      guildEmojis: {
        ...state.guildEmojis,
        [guildId]: [createdEmoji, ...(state.guildEmojis[guildId] || [])],
      },
    }));

    return createdEmoji;
  },

  uploadUserEmoji: async (name: string, file: File) => {
    const { token } = useAuthStore.getState();
    if (!token) throw new Error("未登录");

    const trimmedName = name.trim();
    if (!/^[a-zA-Z0-9_]{2,32}$/.test(trimmedName)) {
      throw new Error("表情名称必须为 2-32 位字母、数字或下划线");
    }

    const { blob, mimeType, isAnimated } = await processEmojiImage(file);
    const extension = isAnimated ? "gif" : "png";
    const filename = `${trimmedName}.${extension}`;

    // 1. 获取预签名上传链接
    const presignRes = await fetch(
      `${API_BASE}/api/attachments/presigned-url`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          fileName: filename,
          fileSize: blob.size,
          mimeType,
          purpose: "custom-emoji",
        }),
      },
    );

    if (!presignRes.ok) {
      const err = await presignRes.json().catch(() => ({}));
      throw new Error(err.error || "获取表情上传链接失败");
    }

    const { uploadUrl, fileUrl, requiresAuth } = await presignRes.json();

    // 2. 直传文件
    const uploadTarget = resolveServerUrl(uploadUrl);
    const uploadRes = await fetch(uploadTarget, {
      method: "PUT",
      headers: {
        "Content-Type": mimeType,
        ...(requiresAuth ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: blob,
    });

    if (!uploadRes.ok) {
      throw new Error("上传表情图片数据失败");
    }

    // 3. 登记表情
    const createRes = await fetch(`${API_BASE}/api/users/me/emojis`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        name: trimmedName,
        imageUrl: fileUrl,
        animated: isAnimated,
      }),
    });

    if (!createRes.ok) {
      const err = await createRes.json().catch(() => ({}));
      throw new Error(err.error || "创建用户表情失败");
    }

    const createdEmoji: CustomEmoji = await createRes.json();
    set((state) => ({
      userEmojis: [createdEmoji, ...state.userEmojis],
    }));

    return createdEmoji;
  },

  deleteGuildEmoji: async (guildId: string, emojiId: string) => {
    const { token } = useAuthStore.getState();
    if (!token) throw new Error("未登录");

    const res = await fetch(
      `${API_BASE}/api/guilds/${guildId}/emojis/${emojiId}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "删除表情失败");
    }

    set((state) => ({
      guildEmojis: {
        ...state.guildEmojis,
        [guildId]: (state.guildEmojis[guildId] || []).filter(
          (e) => e.id !== emojiId,
        ),
      },
    }));
  },

  deleteUserEmoji: async (emojiId: string) => {
    const { token } = useAuthStore.getState();
    if (!token) throw new Error("未登录");

    const res = await fetch(`${API_BASE}/api/users/me/emojis/${emojiId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "删除表情失败");
    }

    set((state) => ({
      userEmojis: state.userEmojis.filter((e) => e.id !== emojiId),
    }));
  },
}));
