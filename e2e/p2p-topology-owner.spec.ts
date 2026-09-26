import { test, expect } from "@playwright/test";
import { P2PTopologyManager } from "../apps/server/src/p2pTopology";

test("a viewer or unrelated streamer cannot remove the active P2P stream", () => {
  const topology = new P2PTopologyManager();
  topology.registerStream("channel", "guild", "alice", "p2p_direct");
  expect(topology.addViewer("channel", "bob")).not.toBeNull();
  expect(topology.removeViewer("channel", "alice")).toBeNull();
  expect(topology.getRoom("channel")?.streamOwnerId).toBe("alice");
  topology.unregisterStream("channel", "bob");
  expect(topology.getRoom("channel")?.streamOwnerId).toBe("alice");
  topology.unregisterStream("channel", "alice");
  expect(topology.getRoom("channel")).toBeUndefined();
});
