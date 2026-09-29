const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

const sourcePath = path.resolve(
  __dirname,
  "../apps/web/src/services/p2p/VoiceMeshManager.ts",
);
const source = fs.readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

function createManager({
  encrypted,
  failReceiver = false,
  failReceiverAfterFirst = false,
  callId = "call-1",
}) {
  const attachedSenders = [];
  const attachedReceivers = [];
  const created = [];
  const sframeManager = {
    getStats: () => ({ enabled: encrypted }),
    attachSender(sender) {
      attachedSenders.push(sender);
    },
    attachReceiver(receiver) {
      if (
        failReceiver ||
        (failReceiverAfterFirst && attachedReceivers.length > 0)
      ) {
        throw new Error("Insertable Streams unavailable");
      }
      attachedReceivers.push(receiver);
    },
  };

  class FakePeerConnection {
    constructor(configuration) {
      this.configuration = configuration;
      this.closed = false;
      this.connectionState = "new";
      created.push(this);
    }
    addTrack() {
      return { kind: "audio-sender" };
    }
    addTransceiver(kind) {
      assert.equal(kind, "video");
      this.videoSender = { replaceTrack: async () => {} };
      this.videoReceiver = { kind: "video-receiver" };
      return { sender: this.videoSender, receiver: this.videoReceiver };
    }
    close() {
      this.closed = true;
    }
  }

  const exports = {};
  vm.runInNewContext(
    compiled,
    {
      exports,
      require(specifier) {
        if (specifier === "../sframe.js") return { sframeManager };
        if (specifier === "../livekit.js") {
          return { livekitService: { onParticipantVolumeChange() {} } };
        }
        return {};
      },
      RTCPeerConnection: FakePeerConnection,
      console,
      setTimeout,
      clearTimeout,
    },
    { filename: sourcePath },
  );

  const manager = Object.create(exports.VoiceMeshManager.prototype);
  manager.activeCallId = callId;
  manager.currentIceServers = [];
  manager.peerConnections = new Map();
  manager.videoSenders = new Map();
  manager.remoteCameraTracks = new Map();
  manager.localAudioTrack = { kind: "audio" };
  manager.localVideoTrack = { kind: "video" };
  manager.setPeerReport = () => {};
  manager.notifyCameraTracksChange = () => {};
  manager.closePeer = (peerId) => {
    const pc = manager.peerConnections.get(peerId);
    manager.peerConnections.delete(peerId);
    manager.videoSenders.delete(peerId);
    pc?.close();
  };
  return { manager, attachedSenders, attachedReceivers, created };
}

test("DM video sender and receiver have SFrame before track is exposed", () => {
  const { manager, attachedSenders, attachedReceivers, created } =
    createManager({
      encrypted: true,
    });
  const pc = manager.getOrCreatePeerConnection("peer-1");
  assert.equal(pc.configuration.encodedInsertableStreams, true);
  assert.equal(attachedSenders.length, 2);
  assert.equal(attachedSenders[1], pc.videoSender);
  assert.deepEqual(attachedReceivers, [pc.videoReceiver]);
  assert.equal(manager.videoSenders.get("peer-1"), pc.videoSender);
  assert.equal(created.length, 1);

  const videoTrack = { kind: "video" };
  pc.ontrack({ track: videoTrack, receiver: pc.videoReceiver });
  assert.equal(manager.remoteCameraTracks.get("peer-1"), videoTrack);
  assert.equal(attachedReceivers.length, 1);
});

test("DM connection fails before creation without a negotiated key", () => {
  const { manager, created } = createManager({ encrypted: false });
  assert.throws(
    () => manager.getOrCreatePeerConnection("peer-1"),
    /E2EE 密钥未就绪/,
  );
  assert.equal(created.length, 0);
});

test("DM connection closes when video receiver encryption cannot attach", () => {
  const { manager, created } = createManager({
    encrypted: true,
    failReceiver: true,
  });
  assert.throws(
    () => manager.getOrCreatePeerConnection("peer-1"),
    /Insertable Streams unavailable/,
  );
  assert.equal(created[0].closed, true);
  assert.equal(manager.peerConnections.size, 0);
  assert.equal(manager.videoSenders.size, 0);
});

test("extra remote video receiver is rejected if decryption cannot attach", () => {
  const { manager, attachedReceivers } = createManager({
    encrypted: true,
    failReceiverAfterFirst: true,
  });
  const pc = manager.getOrCreatePeerConnection("peer-1");
  pc.ontrack({ track: { kind: "video" }, receiver: { kind: "extra" } });
  assert.equal(pc.closed, true);
  assert.equal(manager.remoteCameraTracks.size, 0);
  assert.equal(attachedReceivers.length, 1);
});

test("ordinary non-E2EE mesh does not request encoded streams", () => {
  const { manager, attachedSenders, attachedReceivers } = createManager({
    encrypted: false,
    callId: null,
  });
  const pc = manager.getOrCreatePeerConnection("peer-1");
  assert.equal(pc.configuration.encodedInsertableStreams, undefined);
  assert.equal(attachedSenders.length, 0);
  assert.equal(attachedReceivers.length, 0);
});
