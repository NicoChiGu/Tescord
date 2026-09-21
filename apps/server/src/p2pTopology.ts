import {
  StreamTransmissionMode,
  P2PTopologyNode,
  P2PNodeMetrics,
  P2PTopologyUpdatePayload,
} from "@tescord/types";

export interface ActiveP2PRoom {
  channelId: string;
  guildId: string;
  streamOwnerId: string;
  transmissionMode: StreamTransmissionMode;
  nodes: Map<string, P2PTopologyNode>;
  metrics: Map<string, P2PNodeMetrics>;
}

export class P2PTopologyManager {
  // channelId -> ActiveP2PRoom
  private rooms: Map<string, ActiveP2PRoom> = new Map();

  /**
   * 主播开启 P2P 直播时初始化或更新房间拓扑
   */
  public registerStream(
    channelId: string,
    guildId: string,
    streamOwnerId: string,
    transmissionMode: StreamTransmissionMode,
  ): P2PTopologyUpdatePayload {
    const nodes = new Map<string, P2PTopologyNode>();
    const metrics = new Map<string, P2PNodeMetrics>();

    // 根节点（主播本人）
    nodes.set(streamOwnerId, {
      peerId: streamOwnerId,
      parentId: null,
      childrenIds: [],
      transmissionMode,
    });

    const room: ActiveP2PRoom = {
      channelId,
      guildId,
      streamOwnerId,
      transmissionMode,
      nodes,
      metrics,
    };

    this.rooms.set(channelId, room);

    return this.buildTopologyPayload(room);
  }

  /**
   * 停止 P2P 直播并清理房间
   */
  public unregisterStream(channelId: string): void {
    this.rooms.delete(channelId);
  }

  public getRoom(channelId: string): ActiveP2PRoom | undefined {
    return this.rooms.get(channelId);
  }

  /**
   * 观众加入观看 P2P 直播，分配拓扑父节点
   */
  public addViewer(
    channelId: string,
    viewerId: string,
    initialMetrics?: P2PNodeMetrics,
  ): {
    payload: P2PTopologyUpdatePayload;
    assignedParentId: string | null;
  } | null {
    const room = this.rooms.get(channelId);
    if (!room) return null;

    if (initialMetrics) {
      room.metrics.set(viewerId, initialMetrics);
    }

    let assignedParentId: string | null = null;

    if (room.transmissionMode === "p2p_direct") {
      // 直连 Mesh：所有观众的父节点直接是主播
      assignedParentId = room.streamOwnerId;
      const ownerNode = room.nodes.get(room.streamOwnerId);
      if (ownerNode && !ownerNode.childrenIds.includes(viewerId)) {
        ownerNode.childrenIds.push(viewerId);
      }
    } else if (room.transmissionMode === "p2p_relay") {
      // 智能树状接力：选择网络质量评分最高且未满载的节点作为父节点
      assignedParentId = this.selectBestRelayParent(room, viewerId);
      const parentNode = room.nodes.get(assignedParentId);
      if (parentNode && !parentNode.childrenIds.includes(viewerId)) {
        parentNode.childrenIds.push(viewerId);
      }
    }

    const newNode: P2PTopologyNode = {
      peerId: viewerId,
      parentId: assignedParentId,
      childrenIds: [],
      transmissionMode: room.transmissionMode,
      metrics: initialMetrics,
    };

    room.nodes.set(viewerId, newNode);

    return {
      payload: this.buildTopologyPayload(room),
      assignedParentId,
    };
  }

  /**
   * 观众上报网络质量指标并评估是否需要动态优化拓扑
   */
  public reportMetrics(
    channelId: string,
    userId: string,
    metrics: P2PNodeMetrics,
  ): P2PTopologyUpdatePayload | null {
    const room = this.rooms.get(channelId);
    if (!room) return null;

    room.metrics.set(userId, metrics);
    const node = room.nodes.get(userId);
    if (node) {
      node.metrics = metrics;
    }

    return this.buildTopologyPayload(room);
  }

  /**
   * 观众退出或切换模式，动态重构其下游节点的父子关系
   */
  public removeViewer(
    channelId: string,
    viewerId: string,
  ): P2PTopologyUpdatePayload | null {
    const room = this.rooms.get(channelId);
    if (!room) return null;

    const departingNode = room.nodes.get(viewerId);
    if (!departingNode) return null;

    // 1. 从其原父节点的 childrenIds 中移除
    if (departingNode.parentId) {
      const parentNode = room.nodes.get(departingNode.parentId);
      if (parentNode) {
        parentNode.childrenIds = parentNode.childrenIds.filter(
          (id) => id !== viewerId,
        );
      }
    }

    // 2. 将离线节点的所有孤儿子节点重新分配给最优备选中继
    const orphanedChildren = [...departingNode.childrenIds];
    room.nodes.delete(viewerId);
    room.metrics.delete(viewerId);

    for (const orphanId of orphanedChildren) {
      const orphanNode = room.nodes.get(orphanId);
      if (!orphanNode) continue;

      const newParentId = this.selectBestRelayParent(room, orphanId);
      orphanNode.parentId = newParentId;

      const newParentNode = room.nodes.get(newParentId);
      if (newParentNode && !newParentNode.childrenIds.includes(orphanId)) {
        newParentNode.childrenIds.push(orphanId);
      }
    }

    return this.buildTopologyPayload(room);
  }

  /**
   * 树状质量调度评分算法：
   * Score = NATType权重 + IPv6权重 - RTT惩罚 - 丢包惩罚
   */
  private computeNodeScore(metrics?: P2PNodeMetrics): number {
    if (!metrics) return 10;

    let score = 0;

    // 1. IPv6 权重（无 NAT，公网互通）
    if (metrics.hasIPv6) {
      score += 50;
    }

    // 2. NAT 类型穿透能力评分
    switch (metrics.natType) {
      case "IPv6Direct":
      case "FullCone":
        score += 40;
        break;
      case "RestrictedCone":
        score += 30;
        break;
      case "PortRestrictedCone":
        score += 20;
        break;
      case "Symmetric":
        score += 5;
        break;
      default:
        score += 10;
        break;
    }

    // 3. 往返延迟 (RTT) 奖励与惩罚
    if (metrics.rtt > 0) {
      if (metrics.rtt < 40) score += 20;
      else if (metrics.rtt < 100) score += 10;
      else if (metrics.rtt > 200) score -= 15;
    }

    // 4. 丢包率惩罚
    if (metrics.packetLoss > 0.05) {
      score -= 30;
    } else if (metrics.packetLoss < 0.01) {
      score += 10;
    }

    return Math.max(0, score);
  }

  /**
   * 为新节点挑选最佳中继父节点
   */
  private selectBestRelayParent(
    room: ActiveP2PRoom,
    candidateChildId: string,
  ): string {
    const MAX_CHILDREN_PER_NODE = 2; // 每个中继节点默认只带 2 个下游，防止中继带宽超标

    // 候选父节点池（排除自己）
    const candidateParents = Array.from(room.nodes.values()).filter(
      (n) => n.peerId !== candidateChildId,
    );

    if (candidateParents.length === 0) {
      return room.streamOwnerId;
    }

    // 优先选择未满载的节点
    const availableParents = candidateParents.filter(
      (n) =>
        n.childrenIds.length <
        (n.metrics?.maxDownstream || MAX_CHILDREN_PER_NODE),
    );

    // 如果都有容量，按网络质量评分从高到低排序
    const pool =
      availableParents.length > 0 ? availableParents : candidateParents;

    pool.sort((a, b) => {
      // 主播节点作为基石优先级
      if (a.peerId === room.streamOwnerId && a.childrenIds.length < 2)
        return -1;
      if (b.peerId === room.streamOwnerId && b.childrenIds.length < 2) return 1;

      const scoreA = this.computeNodeScore(a.metrics);
      const scoreB = this.computeNodeScore(b.metrics);
      return scoreB - scoreA;
    });

    return pool[0]?.peerId || room.streamOwnerId;
  }

  private buildTopologyPayload(room: ActiveP2PRoom): P2PTopologyUpdatePayload {
    const nodesRecord: Record<string, P2PTopologyNode> = {};
    for (const [id, node] of room.nodes.entries()) {
      nodesRecord[id] = {
        ...node,
        childrenIds: [...node.childrenIds],
      };
    }

    return {
      streamOwnerId: room.streamOwnerId,
      channelId: room.channelId,
      transmissionMode: room.transmissionMode,
      nodes: nodesRecord,
    };
  }
}

export const p2pTopologyManager = new P2PTopologyManager();
