import { create } from "zustand";
import { Message, Guild, UserStatus } from "@tescord/types";

export interface MessageMenuData {
  type: "message";
  message: Message;
  guild?: Guild | null;
  onReply?: (message: Message) => void;
  onEdit?: (message: Message) => void;
  onDelete?: (messageId: string) => void;
  onTogglePin?: (messageId: string) => void;
  onAddReaction?: (messageId: string, emoji: string) => void;
}

export interface UserMenuData {
  type: "user";
  targetUser: {
    id: string;
    username: string;
    avatarUrl?: string | null;
    status?: UserStatus;
  };
  guild?: Guild | null;
  isInVoice?: boolean;
  isStreaming?: boolean;
  onStopScreenShare?: () => void;
  onMention?: (username: string) => void;
  onOpenProfile?: (userId: string) => void;
  onSendMessage?: (userId: string) => void;
  onShowStats?: () => void;
  onOpenUserSettings?: () => void;
  onOpenAudioSettings?: () => void;
  onKickMember?: (userId: string, username: string) => void;
  onBanMember?: (userId: string, username: string) => void;
}

export type ContextMenuData = MessageMenuData | UserMenuData;

interface ContextMenuState {
  isOpen: boolean;
  x: number;
  y: number;
  data: ContextMenuData | null;
  openMenu: (x: number, y: number, data: ContextMenuData) => void;
  closeMenu: () => void;
}

export const useContextMenuStore = create<ContextMenuState>((set) => ({
  isOpen: false,
  x: 0,
  y: 0,
  data: null,
  openMenu: (x, y, data) => set({ isOpen: true, x, y, data }),
  closeMenu: () => set({ isOpen: false, data: null }),
}));
