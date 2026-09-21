import dgram from "dgram";
import http from "http";
import os from "os";
import { URL } from "url";

export interface LocalNetworkInfo {
  ipv4List: string[];
  ipv6List: string[];
  hasPublicIPv6: boolean;
  defaultIPv4?: string;
  defaultIPv6?: string;
}

export interface UPnPResult {
  success: boolean;
  externalIP?: string;
  mappedPort?: number;
  protocol?: string;
  error?: string;
}

/**
 * 探测本机网卡网络地址（优先识别全球单播 IPv6 与有效局域网 IPv4）
 */
export function detectLocalNetwork(): LocalNetworkInfo {
  const interfaces = os.networkInterfaces();
  const ipv4List: string[] = [];
  const ipv6List: string[] = [];
  let hasPublicIPv6 = false;
  let defaultIPv4: string | undefined;
  let defaultIPv6: string | undefined;

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.internal) continue;

      if (addr.family === "IPv4") {
        ipv4List.push(addr.address);
        if (
          !defaultIPv4 &&
          (addr.address.startsWith("192.168.") ||
            addr.address.startsWith("10.") ||
            addr.address.startsWith("172."))
        ) {
          defaultIPv4 = addr.address;
        }
      } else if (addr.family === "IPv6") {
        const ip6 = addr.address.toLowerCase();
        // 排除链路本地地址 (fe80::) 与回环
        if (!ip6.startsWith("fe80:") && !ip6.startsWith("::1")) {
          ipv6List.push(addr.address);
          hasPublicIPv6 = true;
          if (!defaultIPv6) {
            defaultIPv6 = addr.address;
          }
        }
      }
    }
  }

  return {
    ipv4List,
    ipv6List,
    hasPublicIPv6,
    defaultIPv4: defaultIPv4 || ipv4List[0],
    defaultIPv6: defaultIPv6 || ipv6List[0],
  };
}

/**
 * 轻量级 SSDP / UPnP IGD 端口映射器
 */
export class UPnPClient {
  private static activeMappings = new Map<
    number,
    { localPort: number; protocol: string }
  >();

  /**
   * 自动通过 SSDP 发现家庭路由器 IGD 控制端点并申请开辟外部端口映射
   */
  public static async mapPort(
    port: number,
    protocol: "UDP" | "TCP" = "UDP",
    description = "Tescord P2P Live",
  ): Promise<UPnPResult> {
    const netInfo = detectLocalNetwork();
    const localIP = netInfo.defaultIPv4;
    if (!localIP) {
      return { success: false, error: "No local IPv4 address found" };
    }

    try {
      const controlUrl = await this.discoverIGDControlURL(2000);
      if (!controlUrl) {
        return {
          success: false,
          error: "UPnP IGD not found or router ignored SSDP",
        };
      }

      const externalIP = await this.getExternalIP(controlUrl);

      // 发送 SOAP AddPortMapping
      const soapBody = `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:AddPortMapping xmlns:u="urn:schemas-upnp-org:service:WANIPConnection:1">
      <NewRemoteHost></NewRemoteHost>
      <NewExternalPort>${port}</NewExternalPort>
      <NewProtocol>${protocol}</NewProtocol>
      <NewInternalPort>${port}</NewInternalPort>
      <NewInternalClient>${localIP}</NewInternalClient>
      <NewEnabled>1</NewEnabled>
      <NewPortMappingDescription>${description}</NewPortMappingDescription>
      <NewLeaseDuration>3600</NewLeaseDuration>
    </u:AddPortMapping>
  </s:Body>
</s:Envelope>`;

      await this.sendSoapRequest(
        controlUrl,
        "urn:schemas-upnp-org:service:WANIPConnection:1#AddPortMapping",
        soapBody,
      );

      this.activeMappings.set(port, { localPort: port, protocol });

      return {
        success: true,
        externalIP: externalIP || "AutoAssigned",
        mappedPort: port,
        protocol,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || String(err),
      };
    }
  }

  /**
   * 释放 UPnP 端口映射
   */
  public static async unmapPort(
    port: number,
    protocol: "UDP" | "TCP" = "UDP",
  ): Promise<boolean> {
    try {
      const controlUrl = await this.discoverIGDControlURL(1500);
      if (!controlUrl) return false;

      const soapBody = `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:DeletePortMapping xmlns:u="urn:schemas-upnp-org:service:WANIPConnection:1">
      <NewRemoteHost></NewRemoteHost>
      <NewExternalPort>${port}</NewExternalPort>
      <NewProtocol>${protocol}</NewProtocol>
    </u:DeletePortMapping>
  </s:Body>
</s:Envelope>`;

      await this.sendSoapRequest(
        controlUrl,
        "urn:schemas-upnp-org:service:WANIPConnection:1#DeletePortMapping",
        soapBody,
      );

      this.activeMappings.delete(port);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 通过 SSDP 广播发现 WANIPConnection 服务控制地址
   */
  private static discoverIGDControlURL(
    timeoutMs = 2000,
  ): Promise<string | null> {
    return new Promise((resolve) => {
      const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
      let resolved = false;

      const finish = (url: string | null) => {
        if (resolved) return;
        resolved = true;
        try {
          socket.close();
        } catch {}
        resolve(url);
      };

      const timer = setTimeout(() => {
        finish(null);
      }, timeoutMs);

      socket.on("error", () => finish(null));

      socket.on("message", (msg) => {
        const text = msg.toString();
        if (text.includes("200 OK") || text.includes("NOTIFY")) {
          const match = text.match(/LOCATION:\s*(http:\/\/[^\r\n]+)/i);
          if (match && match[1]) {
            clearTimeout(timer);
            this.fetchControlURLFromLocation(match[1].trim())
              .then((ctrl) => finish(ctrl))
              .catch(() => finish(null));
          }
        }
      });

      socket.bind(0, () => {
        const searchTarget =
          "urn:schemas-upnp-org:device:InternetGatewayDevice:1";
        const mSearch = [
          "M-SEARCH * HTTP/1.1",
          "HOST: 239.255.255.250:1900",
          'MAN: "ssdp:discover"',
          "MX: 2",
          `ST: ${searchTarget}`,
          "",
          "",
        ].join("\r\n");

        socket.send(Buffer.from(mSearch), 1900, "239.255.255.250");
      });
    });
  }

  private static fetchControlURLFromLocation(
    location: string,
  ): Promise<string | null> {
    return new Promise((resolve) => {
      http
        .get(location, { timeout: 1500 }, (res) => {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => {
            const match =
              body.match(/<controlURL>(.+?)<\/controlURL>/i) ||
              body.match(/<controlURL\s*>(.+?)<\/controlURL>/i);
            if (match && match[1]) {
              const rel = match[1].trim();
              const fullUrl = new URL(rel, location).toString();
              resolve(fullUrl);
            } else {
              resolve(null);
            }
          });
        })
        .on("error", () => resolve(null));
    });
  }

  private static getExternalIP(controlUrl: string): Promise<string | null> {
    const soapBody = `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:GetExternalIPAddress xmlns:u="urn:schemas-upnp-org:service:WANIPConnection:1" />
  </s:Body>
</s:Envelope>`;

    return this.sendSoapRequest(
      controlUrl,
      "urn:schemas-upnp-org:service:WANIPConnection:1#GetExternalIPAddress",
      soapBody,
    )
      .then((xml) => {
        const match = xml.match(
          /<NewExternalIPAddress>(.+?)<\/NewExternalIPAddress>/i,
        );
        return match ? match[1].trim() : null;
      })
      .catch(() => null);
  }

  private static sendSoapRequest(
    controlUrl: string,
    soapAction: string,
    body: string,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(controlUrl);
      const req = http.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || 80,
          path: parsed.pathname + parsed.search,
          method: "POST",
          headers: {
            "Content-Type": 'text/xml; charset="utf-8"',
            SOAPAction: `"${soapAction}"`,
            "Content-Length": Buffer.byteLength(body),
          },
          timeout: 2500,
        },
        (res) => {
          let resData = "";
          res.on("data", (c) => (resData += c));
          res.on("end", () => {
            if (
              res.statusCode &&
              res.statusCode >= 200 &&
              res.statusCode < 300
            ) {
              resolve(resData);
            } else {
              reject(
                new Error(`SOAP error HTTP ${res.statusCode}: ${resData}`),
              );
            }
          });
        },
      );

      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("SOAP request timeout"));
      });
      req.write(body);
      req.end();
    });
  }
}
