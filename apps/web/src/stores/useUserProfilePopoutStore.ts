import { create } from "zustand";
import { User, GuildMember, Guild, Role } from "@tescord/types";

export interface UserProfilePopoutPayload {
  user: User;
  member?: GuildMember | null;
  guild?: Guild | null;
  targetRect: DOMRect;
  roles?: Role[];
  isOwner?: boolean;
  triggerId?: string;
}

interface UserProfilePopoutState {
  isOpen: boolean;
  payload: UserProfilePopoutPayload | null;
  activeUserId: string | null;
  activeTriggerId: string | null;

  openPopout: (payload: UserProfilePopoutPayload) => void;
  closePopout: () => void;
  togglePopout: (payload: UserProfilePopoutPayload) => void;
}

export const useUserProfilePopoutStore = create<UserProfilePopoutState>(
  (set, get) => ({
    isOpen: false,
    payload: null,
    activeUserId: null,
    activeTriggerId: null,

    openPopout: (payload) => {
      set({
        isOpen: true,
        payload,
        activeUserId: payload.user.id,
        activeTriggerId: payload.triggerId || payload.user.id,
      });
    },

    closePopout: () => {
      set({
        isOpen: false,
        payload: null,
        activeUserId: null,
        activeTriggerId: null,
      });
    },

    togglePopout: (payload) => {
      const current = get();
      const triggerId = payload.triggerId || payload.user.id;
      // 若当前已打开且触发 ID 一致，则折叠关闭；否则打开/切换至新用户卡片
      if (current.isOpen && current.activeTriggerId === triggerId) {
        set({
          isOpen: false,
          payload: null,
          activeUserId: null,
          activeTriggerId: null,
        });
      } else {
        set({
          isOpen: true,
          payload,
          activeUserId: payload.user.id,
          activeTriggerId: triggerId,
        });
      }
    },
  }),
);
