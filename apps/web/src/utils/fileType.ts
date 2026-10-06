import type { Attachment } from "@tescord/types";

/**
 * 判断附件或文件名是否为 STL 3D 模型
 */
export const isStlFile = (mimeType?: string, fileName?: string): boolean => {
  const name = fileName || "";
  const mime = mimeType || "";
  return (
    /\.stl$/i.test(name) ||
    mime === "model/stl" ||
    mime === "model/x.stl-ascii" ||
    mime === "model/x.stl-binary" ||
    mime === "application/sla" ||
    mime === "application/vnd.ms-pki.stl"
  );
};

/**
 * 格式化数字（千分位）
 */
export const formatNumber = (num: number): string => {
  return new Intl.NumberFormat().format(num);
};

/**
 * 格式化尺寸数值（毫米）
 */
export const formatDimension = (val: number): string => {
  return (Math.round(val * 100) / 100).toFixed(2);
};
