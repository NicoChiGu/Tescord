/**
 * WebAuthn (Passkey) 前端能力探测与辅助工具
 */

export function isWebAuthnSupported(): boolean {
  if (typeof window === "undefined") return false;
  // Electron 桌面端通过独立认证窗口支持通行密钥
  if (Boolean((window as any).electronAPI?.openPasskeyAuth)) {
    return true;
  }
  // file:// 协议源无法满足 WebAuthn 的 RP ID 域名要求
  if (window.location.protocol === "file:") return false;
  return Boolean(
    window.PublicKeyCredential &&
    typeof window.PublicKeyCredential === "function",
  );
}

export function getDefaultDeviceName(): string {
  if (typeof navigator === "undefined") return "通行密钥";
  const ua = navigator.userAgent;
  let platform = "设备";
  if (/Macintosh|Mac OS X/i.test(ua)) {
    platform = "Mac (Touch ID)";
  } else if (/Windows/i.test(ua)) {
    platform = "Windows Hello";
  } else if (/iPhone|iPad|iPod/i.test(ua)) {
    platform = "Apple 设备 (Face ID)";
  } else if (/Android/i.test(ua)) {
    platform = "Android 设备";
  } else if (/Linux/i.test(ua)) {
    platform = "Linux 安全密钥";
  }

  let browser = "";
  if (/Edg/i.test(ua)) {
    browser = "Edge";
  } else if (/Chrome/i.test(ua)) {
    browser = "Chrome";
  } else if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) {
    browser = "Safari";
  } else if (/Firefox/i.test(ua)) {
    browser = "Firefox";
  }

  return browser ? `${platform} · ${browser}` : platform;
}
