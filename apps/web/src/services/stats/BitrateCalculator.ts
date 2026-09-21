/**
 * 传输速率与流量差值采样计算器 (BitrateCalculator)
 * 解决 WebRTC getStats 中 bytesSent / bytesReceived 为累计总字节数导致码率暴涨的缺陷。
 * 通过保存上一采样点的时间戳与字节数，根据真实时间差 Δt 计算精确瞬时比特率 (bps)。
 */

export interface BitrateSample {
  bytesSent: number;
  bytesReceived: number;
  timestamp: number;
  lastUploadBps: number;
  lastDownloadBps: number;
}

export interface BitrateResult {
  uploadBps: number;
  downloadBps: number;
  uploadFormatted: string;
  downloadFormatted: string;
  totalBytesSent: number;
  totalBytesReceived: number;
}

export class BitrateCalculator {
  private samples: Map<string, BitrateSample> = new Map();

  /**
   * 格式化比特率为可读字符串 (含瞬时速率与累计传输数据量)
   */
  public static formatBitrate(bps: number, totalBytes?: number): string {
    let rateStr = "0 Kbps";
    if (bps >= 1_000_000) {
      rateStr = `${(bps / 1_000_000).toFixed(2)} Mbps`;
    } else if (bps > 0) {
      rateStr = `${Math.round(bps / 1000)} Kbps`;
    } else {
      rateStr = "0 Kbps";
    }

    if (totalBytes !== undefined && totalBytes > 0) {
      const mb = (totalBytes / (1024 * 1024)).toFixed(1);
      return `${rateStr} (${mb} MB)`;
    }
    return rateStr;
  }

  /**
   * 计算指定通道的瞬时上行与下行码率
   * @param key 通道唯一键 (如 identity 或 peerId)
   * @param bytesSent 当前累计已发送字节
   * @param bytesReceived 当前累计已接收字节
   * @param timestamp 当前时间戳 (毫秒，可选，默认 performance.now())
   */
  public compute(
    key: string,
    bytesSent: number,
    bytesReceived: number,
    timestamp: number = performance.now(),
  ): BitrateResult {
    const prev = this.samples.get(key);

    if (!prev) {
      this.samples.set(key, {
        bytesSent,
        bytesReceived,
        timestamp,
        lastUploadBps: 0,
        lastDownloadBps: 0,
      });

      return {
        uploadBps: 0,
        downloadBps: 0,
        uploadFormatted: BitrateCalculator.formatBitrate(0, bytesSent),
        downloadFormatted: BitrateCalculator.formatBitrate(0, bytesReceived),
        totalBytesSent: bytesSent,
        totalBytesReceived: bytesReceived,
      };
    }

    const deltaMs = timestamp - prev.timestamp;

    // 防止极其高频的重复调用导致除以 0
    if (deltaMs < 200) {
      return {
        uploadBps: prev.lastUploadBps,
        downloadBps: prev.lastDownloadBps,
        uploadFormatted: BitrateCalculator.formatBitrate(
          prev.lastUploadBps,
          bytesSent,
        ),
        downloadFormatted: BitrateCalculator.formatBitrate(
          prev.lastDownloadBps,
          bytesReceived,
        ),
        totalBytesSent: bytesSent,
        totalBytesReceived: bytesReceived,
      };
    }

    const deltaSec = deltaMs / 1000;
    // 当连接重置或溢出时，保护不产生负数
    const deltaSent = Math.max(0, bytesSent - prev.bytesSent);
    const deltaReceived = Math.max(0, bytesReceived - prev.bytesReceived);

    const uploadBps = Math.round((deltaSent * 8) / deltaSec);
    const downloadBps = Math.round((deltaReceived * 8) / deltaSec);

    // 写入新采样点
    this.samples.set(key, {
      bytesSent,
      bytesReceived,
      timestamp,
      lastUploadBps: uploadBps,
      lastDownloadBps: downloadBps,
    });

    return {
      uploadBps,
      downloadBps,
      uploadFormatted: BitrateCalculator.formatBitrate(uploadBps, bytesSent),
      downloadFormatted: BitrateCalculator.formatBitrate(
        downloadBps,
        bytesReceived,
      ),
      totalBytesSent: bytesSent,
      totalBytesReceived: bytesReceived,
    };
  }

  /**
   * 清除指定或全部采样缓存
   */
  public reset(key?: string): void {
    if (key) {
      this.samples.delete(key);
    } else {
      this.samples.clear();
    }
  }
}

export const bitrateCalculator = new BitrateCalculator();
