import { API_BASE } from "../config.js";
import { DevicePublicKey, MediaKeyEnvelopePayload } from "@tescord/types";

interface StoredDeviceKeys {
  id: string;
  signingPrivateKey: CryptoKey;
  agreementPrivateKey: CryptoKey;
  signingPublicJwk: JsonWebKey;
  agreementPublicJwk: JsonWebKey;
  fingerprint: string;
}

export interface MediaKeyTrustResult {
  key: Uint8Array;
  trust: "tofu" | "trusted";
  fingerprint: string;
}

interface TrustedPeerDevice {
  fingerprint: string;
  signingKeyHash: string;
}

const openDatabase = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("tescord-device-keys", 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("keys"))
        request.result.createObjectStore("keys", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const bytesToBase64Url = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
};
const base64UrlToBytes = (value: string) => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(
    normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="),
  );
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

class DeviceKeyService {
  private current: StoredDeviceKeys | null = null;
  async ensureAndRegister(
    userId: string,
    token: string,
  ): Promise<StoredDeviceKeys> {
    const deviceStorageKey = `tescord_device_id:${userId}`;
    let deviceId = localStorage.getItem(deviceStorageKey);
    if (!deviceId) {
      deviceId = crypto.randomUUID();
      localStorage.setItem(deviceStorageKey, deviceId);
    }
    const id = `${userId}:${deviceId}`;
    const db = await openDatabase();
    let stored = await new Promise<StoredDeviceKeys | undefined>(
      (resolve, reject) => {
        const request = db
          .transaction("keys", "readonly")
          .objectStore("keys")
          .get(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      },
    );
    if (!stored) {
      const [signing, agreement] = await Promise.all([
        crypto.subtle.generateKey(
          { name: "ECDSA", namedCurve: "P-256" },
          false,
          ["sign", "verify"],
        ),
        crypto.subtle.generateKey(
          { name: "ECDH", namedCurve: "P-256" },
          false,
          ["deriveKey", "deriveBits"],
        ),
      ]);
      const [signingPublicJwk, agreementPublicJwk] = await Promise.all([
        crypto.subtle.exportKey("jwk", signing.publicKey),
        crypto.subtle.exportKey("jwk", agreement.publicKey),
      ]);
      const canonicalPublicIdentity = new TextEncoder().encode(
        JSON.stringify({ signingPublicJwk, agreementPublicJwk }),
      );
      const digest = await crypto.subtle.digest(
        "SHA-256",
        canonicalPublicIdentity,
      );
      stored = {
        id,
        signingPrivateKey: signing.privateKey,
        agreementPrivateKey: agreement.privateKey,
        signingPublicJwk,
        agreementPublicJwk,
        fingerprint: bytesToBase64Url(new Uint8Array(digest)),
      };
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction("keys", "readwrite");
        transaction.objectStore("keys").put(stored!);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    }
    db.close();

    const response = await fetch(`${API_BASE}/api/e2ee/devices`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        deviceId,
        signingPublicKey: JSON.stringify(stored.signingPublicJwk),
        agreementPublicKey: JSON.stringify(stored.agreementPublicJwk),
        fingerprint: stored.fingerprint,
      }),
    });
    if (!response.ok)
      throw new Error(
        (await response.json().catch(() => null))?.error || "设备密钥注册失败",
      );
    this.current = stored;
    return stored;
  }

  getDeviceId(): string | null {
    return this.current?.id.split(":").pop() || null;
  }

  async distributeMediaKey(
    channelId: string,
    callId: string,
    devices: DevicePublicKey[],
    token: string,
  ): Promise<MediaKeyTrustResult> {
    if (!this.current) throw new Error("本机设备密钥尚未初始化");
    const senderDeviceId = this.getDeviceId()!;
    const senderUserId = this.current.id.slice(0, -(senderDeviceId.length + 1));
    const roomKey = crypto.getRandomValues(new Uint8Array(32));
    const recipients = devices.filter(
      (device) => device.userId !== senderUserId,
    );
    if (recipients.length === 0)
      throw new Error("对端没有可用的已验证设备密钥");
    let trust: MediaKeyTrustResult["trust"] = "trusted";
    for (const recipient of recipients) {
      const calculatedFingerprint = await this.calculateDeviceFingerprint(
        recipient.signingPublicKey,
        recipient.agreementPublicKey,
      );
      if (calculatedFingerprint !== recipient.fingerprint) {
        throw new Error("对端设备公钥指纹不一致，已终止媒体密钥协商");
      }
      const recipientTrust = await this.rememberPeerDevice(
        recipient.userId,
        recipient.deviceId,
        recipient.fingerprint,
        recipient.signingPublicKey,
      );
      if (recipientTrust === "tofu") trust = "tofu";
      const ephemeral = await crypto.subtle.generateKey(
        { name: "ECDH", namedCurve: "P-256" },
        true,
        ["deriveBits"],
      );
      const recipientPublicKey = await crypto.subtle.importKey(
        "jwk",
        JSON.parse(recipient.agreementPublicKey),
        { name: "ECDH", namedCurve: "P-256" },
        false,
        [],
      );
      const shared = await crypto.subtle.deriveBits(
        { name: "ECDH", public: recipientPublicKey },
        ephemeral.privateKey,
        256,
      );
      const wrappingKey = await this.deriveWrappingKey(
        shared,
        channelId,
        callId,
        senderDeviceId,
        recipient.deviceId,
        ["encrypt"],
      );
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: "AES-GCM", iv },
          wrappingKey,
          roomKey,
        ),
      );
      const ephemeralPublicKey = JSON.stringify(
        await crypto.subtle.exportKey("jwk", ephemeral.publicKey),
      );
      const ivText = bytesToBase64Url(iv);
      const ciphertextText = bytesToBase64Url(ciphertext);
      const signed = new TextEncoder().encode(
        [
          channelId,
          callId,
          senderDeviceId,
          recipient.deviceId,
          ephemeralPublicKey,
          ivText,
          ciphertextText,
        ].join("|"),
      );
      const signature = new Uint8Array(
        await crypto.subtle.sign(
          { name: "ECDSA", hash: "SHA-256" },
          this.current.signingPrivateKey,
          signed,
        ),
      );
      const response = await fetch(
        `${API_BASE}/api/channels/${channelId}/e2ee/media-key`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            callId,
            senderDeviceId,
            recipientDeviceId: recipient.deviceId,
            ephemeralPublicKey,
            iv: ivText,
            ciphertext: ciphertextText,
            signature: bytesToBase64Url(signature),
          }),
        },
      );
      if (!response.ok)
        throw new Error(
          (await response.json().catch(() => null))?.error ||
            "媒体密钥分发失败",
        );
    }
    return { key: roomKey, trust, fingerprint: recipients[0].fingerprint };
  }

  async fetchMediaKey(
    channelId: string,
    callId: string,
    token: string,
  ): Promise<MediaKeyEnvelopePayload> {
    const deviceId = this.getDeviceId();
    if (!deviceId) throw new Error("本机设备密钥尚未初始化");
    const response = await fetch(
      `${API_BASE}/api/channels/${encodeURIComponent(channelId)}/e2ee/media-key/${encodeURIComponent(callId)}?deviceId=${encodeURIComponent(deviceId)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!response.ok)
      throw new Error(
        (await response.json().catch(() => null))?.error || "媒体密钥尚未就绪",
      );
    return response.json() as Promise<MediaKeyEnvelopePayload>;
  }

  async openMediaKey(
    envelope: MediaKeyEnvelopePayload,
  ): Promise<MediaKeyTrustResult | null> {
    if (!this.current || envelope.recipientDeviceId !== this.getDeviceId())
      return null;
    if (Date.now() - Date.parse(envelope.createdAt) > 2 * 60_000)
      throw new Error("媒体密钥信封已过期");
    const signingKeyHash = await this.hashText(envelope.senderSigningPublicKey);
    const trustKey = this.peerTrustKey(
      envelope.senderId,
      envelope.senderDeviceId,
    );
    const known = this.readTrustedPeer(trustKey);
    if (
      known &&
      (known.fingerprint !== envelope.senderFingerprint ||
        known.signingKeyHash !== signingKeyHash)
    ) {
      throw new Error("已知设备身份密钥发生变化，必须重新核对指纹");
    }
    const signed = new TextEncoder().encode(
      [
        envelope.channelId,
        envelope.callId,
        envelope.senderDeviceId,
        envelope.recipientDeviceId,
        envelope.ephemeralPublicKey,
        envelope.iv,
        envelope.ciphertext,
      ].join("|"),
    );
    const signingKey = await crypto.subtle.importKey(
      "jwk",
      JSON.parse(envelope.senderSigningPublicKey),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      signingKey,
      base64UrlToBytes(envelope.signature),
      signed,
    );
    if (!valid) throw new Error("媒体密钥签名无效");
    const ephemeralKey = await crypto.subtle.importKey(
      "jwk",
      JSON.parse(envelope.ephemeralPublicKey),
      { name: "ECDH", namedCurve: "P-256" },
      false,
      [],
    );
    const shared = await crypto.subtle.deriveBits(
      { name: "ECDH", public: ephemeralKey },
      this.current.agreementPrivateKey,
      256,
    );
    const wrappingKey = await this.deriveWrappingKey(
      shared,
      envelope.channelId,
      envelope.callId,
      envelope.senderDeviceId,
      envelope.recipientDeviceId,
      ["decrypt"],
    );
    const clear = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64UrlToBytes(envelope.iv) },
      wrappingKey,
      base64UrlToBytes(envelope.ciphertext),
    );
    if (!known) {
      localStorage.setItem(
        trustKey,
        JSON.stringify({
          fingerprint: envelope.senderFingerprint,
          signingKeyHash,
        } satisfies TrustedPeerDevice),
      );
    }
    return {
      key: new Uint8Array(clear),
      trust: known ? "trusted" : "tofu",
      fingerprint: envelope.senderFingerprint,
    };
  }

  private async calculateDeviceFingerprint(
    signingPublicKey: string,
    agreementPublicKey: string,
  ): Promise<string> {
    const canonical = JSON.stringify({
      signingPublicJwk: JSON.parse(signingPublicKey),
      agreementPublicJwk: JSON.parse(agreementPublicKey),
    });
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(canonical),
    );
    return bytesToBase64Url(new Uint8Array(digest));
  }

  private async hashText(value: string): Promise<string> {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(value),
    );
    return bytesToBase64Url(new Uint8Array(digest));
  }

  private peerTrustKey(peerUserId: string, peerDeviceId: string): string {
    if (!this.current) throw new Error("本机设备密钥尚未初始化");
    return `tescord_trusted_device:${this.current.id}:${peerUserId}:${peerDeviceId}`;
  }

  private readTrustedPeer(key: string): TrustedPeerDevice | null {
    try {
      const value = localStorage.getItem(key);
      return value ? (JSON.parse(value) as TrustedPeerDevice) : null;
    } catch {
      return null;
    }
  }

  private async rememberPeerDevice(
    peerUserId: string,
    peerDeviceId: string,
    fingerprint: string,
    signingPublicKey: string,
  ): Promise<MediaKeyTrustResult["trust"]> {
    const trustKey = this.peerTrustKey(peerUserId, peerDeviceId);
    const signingKeyHash = await this.hashText(signingPublicKey);
    const known = this.readTrustedPeer(trustKey);
    if (
      known &&
      (known.fingerprint !== fingerprint ||
        known.signingKeyHash !== signingKeyHash)
    ) {
      throw new Error("已知设备身份密钥发生变化，必须重新核对指纹");
    }
    if (known) return "trusted";
    localStorage.setItem(
      trustKey,
      JSON.stringify({
        fingerprint,
        signingKeyHash,
      } satisfies TrustedPeerDevice),
    );
    return "tofu";
  }

  private async deriveWrappingKey(
    shared: ArrayBuffer,
    channelId: string,
    callId: string,
    senderDeviceId: string,
    recipientDeviceId: string,
    usages: KeyUsage[],
  ) {
    const material = await crypto.subtle.importKey(
      "raw",
      shared,
      "HKDF",
      false,
      ["deriveKey"],
    );
    return crypto.subtle.deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: new TextEncoder().encode(`tescord:${channelId}:${callId}`),
        info: new TextEncoder().encode(
          `${senderDeviceId}:${recipientDeviceId}`,
        ),
      },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      usages,
    );
  }
}

export const deviceKeyService = new DeviceKeyService();
