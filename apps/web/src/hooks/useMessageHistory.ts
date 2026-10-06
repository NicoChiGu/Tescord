import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type {
  Channel,
  Message,
  MessageHistoryState,
  MessagePage,
} from "@tescord/types";
import { API_BASE } from "../config.js";
import { messageDb } from "../services/messageDb.js";
import { getErrorMessage, tGlobal } from "../i18n/index.js";
import { useAuthStore } from "../stores/useAuthStore.js";

const emptyHistory: MessageHistoryState = {
  hasOlder: false,
  hasNewer: false,
  loadingOlder: false,
  loadingNewer: false,
};
export function mergeHistoryMessages(
  previous: Message[],
  incoming: Message[],
): Message[] {
  const map = new Map(previous.map((message) => [message.id, message]));
  for (const message of incoming) map.set(message.id, message);
  const values = [...map.values()];
  const sequenced = values.every(
    (message) => typeof message.sequence === "number",
  );
  return values.sort(
    (a, b) =>
      (sequenced
        ? a.sequence! - b.sequence!
        : (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0)) ||
      a.id.localeCompare(b.id),
  );
}

function collectContiguousLive(
  messages: Message[],
  pending: Map<string, Message>,
): Message[] {
  let last = messages[messages.length - 1]?.sequence || 0;
  const accepted: Message[] = [];
  for (const message of [...pending.values()].sort(
    (a, b) => (a.sequence || 0) - (b.sequence || 0),
  )) {
    if ((message.sequence || 0) <= last) {
      pending.delete(message.id);
      continue;
    }
    if (message.sequence !== last + 1) break;
    accepted.push(message);
    pending.delete(message.id);
    last = message.sequence;
  }
  return accepted;
}

export function useMessageHistory(
  channel: Channel | null,
  userId: string | undefined,
  messages: Message[],
  setMessages: Dispatch<SetStateAction<Message[]>>,
  setLoading: Dispatch<SetStateAction<boolean>>,
) {
  const [history, setHistoryState] =
    useState<MessageHistoryState>(emptyHistory);
  const scope = `${userId || ""}:${channel?.id || ""}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const historyRef = useRef(history);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const pendingLive = useRef(new Map<string, Message>());
  const controllers = useRef(new Set<AbortController>());
  const generation = useRef(0);
  const initialized = useRef(false);
  const latestBusy = useRef(false);
  const setHistory = useCallback(
    (
      next:
        | MessageHistoryState
        | ((previous: MessageHistoryState) => MessageHistoryState),
    ) => {
      const value =
        typeof next === "function" ? next(historyRef.current) : next;
      historyRef.current = value;
      setHistoryState(value);
    },
    [],
  );

  const requestPage = useCallback(
    async (
      direction?: "older" | "newer",
      cursor?: number,
    ): Promise<MessagePage> => {
      if (!channel || !userId) throw new Error(tGlobal("errors:FORBIDDEN"));
      const controller = new AbortController();
      controllers.current.add(controller);
      const params = new URLSearchParams({
        limit: direction ? "50" : "100",
        format: "page",
      });
      if (direction && cursor !== undefined)
        params.set(direction === "older" ? "before" : "after", String(cursor));
      try {
        const response = await fetch(
          `${API_BASE}/api/channels/${encodeURIComponent(channel.id)}/messages?${params}`,
          {
            signal: controller.signal,
            headers: useAuthStore.getState().getAuthHeaders(),
          },
        );
        if (!response.ok)
          throw await response.json().catch(() => ({ code: "INTERNAL_ERROR" }));
        const body: unknown = await response.json();
        if (Array.isArray(body)) {
          const items = body as Message[];
          return {
            messages: items,
            hasOlder:
              direction !== "newer" && items.length === (direction ? 50 : 100),
            hasNewer: direction === "newer" && items.length === 50,
          };
        }
        if (
          !body ||
          typeof body !== "object" ||
          !("messages" in body) ||
          !Array.isArray(body.messages)
        )
          throw new Error(tGlobal("chat:history.loadFailed"));
        return body as MessagePage;
      } finally {
        controllers.current.delete(controller);
      }
    },
    [channel?.id, userId],
  );

  const reloadLatest = useCallback(async () => {
    if (!channel || channel.type === "VOICE" || !userId || latestBusy.current)
      return;
    const expectedScope = scope;
    const revision = generation.current;
    latestBusy.current = true;
    setLoading(true);
    try {
      const page = await requestPage();
      if (scopeRef.current !== expectedScope || generation.current !== revision)
        return;
      const live = collectContiguousLive(page.messages, pendingLive.current);
      const combined = mergeHistoryMessages(page.messages, live);
      messagesRef.current = combined;
      setMessages(combined);
      initialized.current = true;
      setHistory({
        ...emptyHistory,
        hasOlder: page.hasOlder,
        hasNewer: page.hasNewer || pendingLive.current.size > 0,
      });
      void messageDb.saveMessages(channel.id, combined);
    } catch (error) {
      if (
        scopeRef.current === expectedScope &&
        generation.current === revision &&
        !(error instanceof DOMException && error.name === "AbortError")
      ) {
        setHistory((state) => ({
          ...state,
          newerError: getErrorMessage(error),
        }));
      }
    } finally {
      if (
        scopeRef.current === expectedScope &&
        generation.current === revision
      ) {
        latestBusy.current = false;
        setLoading(false);
      }
    }
  }, [scope, channel?.type, requestPage, setHistory, setLoading, setMessages]);

  useEffect(() => {
    ++generation.current;
    for (const controller of controllers.current) controller.abort();
    controllers.current.clear();
    pendingLive.current.clear();
    initialized.current = false;
    latestBusy.current = false;
    setHistory(emptyHistory);
    messagesRef.current = [];
    setMessages([]);
    if (!channel || channel.type === "VOICE" || !userId) {
      setLoading(false);
      return;
    }
    const expectedScope = scope;
    const revision = generation.current;
    setLoading(true);
    void messageDb
      .getChannelSnapshot(channel.id, 100)
      .then(({ messages: cached }) => {
        if (
          scopeRef.current !== expectedScope ||
          generation.current !== revision ||
          initialized.current ||
          !cached.length
        )
          return;
        messagesRef.current = cached;
        setMessages(cached);
        setHistory((state) => ({ ...state, hasOlder: cached.length >= 100 }));
      })
      .catch(() => {});
    void reloadLatest();
    return () => {
      for (const controller of controllers.current) controller.abort();
    };
  }, [scope, channel?.type, reloadLatest, setHistory, setLoading, setMessages]);

  const loadDirection = useCallback(
    async (direction: "older" | "newer") => {
      if (
        !initialized.current &&
        direction === "newer" &&
        historyRef.current.newerError
      ) {
        await reloadLatest();
        return;
      }
      const state = historyRef.current;
      const busy =
        direction === "older" ? state.loadingOlder : state.loadingNewer;
      const available = direction === "older" ? state.hasOlder : state.hasNewer;
      if (busy || !available || !initialized.current || latestBusy.current)
        return;
      const cursor =
        direction === "older"
          ? messagesRef.current[0]?.sequence
          : messagesRef.current[messagesRef.current.length - 1]?.sequence;
      if (cursor === undefined) return;
      const expectedScope = scope;
      const revision = generation.current;
      setHistory((current) => ({
        ...current,
        [direction === "older" ? "loadingOlder" : "loadingNewer"]: true,
        [direction === "older" ? "olderError" : "newerError"]: undefined,
      }));
      try {
        const page = await requestPage(direction, cursor);
        if (
          scopeRef.current !== expectedScope ||
          generation.current !== revision
        )
          return;
        let incoming = page.messages;
        if (direction === "newer" && !page.hasNewer) {
          const combined = mergeHistoryMessages(messagesRef.current, incoming);
          incoming = mergeHistoryMessages(
            incoming,
            collectContiguousLive(combined, pendingLive.current),
          );
        }
        setMessages((previous) => {
          const merged = mergeHistoryMessages(previous, incoming);
          messagesRef.current = merged;
          return merged;
        });
        setHistory((current) => ({
          ...current,
          [direction === "older" ? "hasOlder" : "hasNewer"]:
            direction === "older"
              ? page.hasOlder
              : page.hasNewer || pendingLive.current.size > 0,
        }));
        if (channel) void messageDb.saveMessages(channel.id, incoming);
      } catch (error) {
        if (
          scopeRef.current === expectedScope &&
          generation.current === revision &&
          !(error instanceof DOMException && error.name === "AbortError")
        ) {
          setHistory((current) => ({
            ...current,
            [direction === "older" ? "olderError" : "newerError"]:
              getErrorMessage(error),
          }));
        }
      } finally {
        if (
          scopeRef.current === expectedScope &&
          generation.current === revision
        )
          setHistory((current) => ({
            ...current,
            [direction === "older" ? "loadingOlder" : "loadingNewer"]: false,
          }));
      }
    },
    [scope, requestPage, channel?.id, setHistory, setMessages, reloadLatest],
  );

  const receiveMessage = useCallback(
    (message: Message) => {
      if (message.channelId !== channel?.id) return false;
      const last =
        messagesRef.current[messagesRef.current.length - 1]?.sequence;
      if (
        !initialized.current ||
        historyRef.current.hasNewer ||
        (last !== undefined && (message.sequence || 0) > last + 1)
      ) {
        pendingLive.current.set(message.id, message);
        if (initialized.current)
          setHistory((state) => ({ ...state, hasNewer: true }));
        return false;
      }
      setMessages((previous) => {
        const merged = mergeHistoryMessages(previous, [message]);
        messagesRef.current = merged;
        return merged;
      });
      return true;
    },
    [channel?.id, setHistory, setMessages],
  );
  return {
    history,
    reloadLatest,
    receiveMessage,
    loadOlder: useCallback(() => loadDirection("older"), [loadDirection]),
    loadNewer: useCallback(() => loadDirection("newer"), [loadDirection]),
  };
}
