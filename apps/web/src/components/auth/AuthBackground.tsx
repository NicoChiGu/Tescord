import React from "react";

/**
 * AuthBackground
 * 为 Web 端认证页面（登录 / 注册）提供类似 Discord 风格的轻量化暗黑极客背景。
 * 融合低对比度科技点阵（Dot Matrix）、细微径向遮罩与 Discord 品牌深色极光纯静态光晕，
 * 视觉克制且具备层次质感，纯静态零 GPU 动画循环开销，100% 离线自治、纯 CSS/SVG 实现、零外部资产依赖。
 */
export const AuthBackground: React.FC = () => {
  return (
    <div
      className="absolute inset-0 overflow-hidden pointer-events-none select-none bg-[#111214]"
      aria-hidden="true"
    >
      {/* 1. 深度暗夜微渐变底层 */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#1e1f22]/70 via-[#111214] to-[#0e0f11]" />

      {/* 2. 科技点阵网格层 (带径向边缘衰减蒙版，避免抢占视觉焦点) */}
      <div
        className="absolute inset-0 opacity-70"
        style={{
          backgroundImage:
            "radial-gradient(rgba(255, 255, 255, 0.08) 1.2px, transparent 1.2px)",
          backgroundSize: "28px 28px",
          maskImage:
            "radial-gradient(ellipse 75% 75% at 50% 50%, #000 35%, transparent 90%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 75% 75% at 50% 50%, #000 35%, transparent 90%)",
        }}
      />

      {/* 3. 极弱科技十字标记（四角精致点缀，工业极客细节） */}
      <svg
        className="absolute w-full h-full inset-0 opacity-[0.05] stroke-white"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern
            id="auth-grid-crosses"
            width="280"
            height="280"
            patternUnits="userSpaceOnUse"
          >
            <path d="M 140 134 L 140 146 M 134 140 L 146 140" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#auth-grid-crosses)" />
      </svg>

      {/* 4. 环境极光光晕 1 (左上方：Discord 标志性 Brand 蓝紫静态光晕，零 GPU 动画开销) */}
      <div
        data-testid="auth-bg-ambient-orb-primary"
        className="absolute -top-32 -left-28 w-[540px] h-[540px] rounded-full blur-[120px] opacity-90"
        style={{
          background:
            "radial-gradient(circle, rgba(88, 101, 242, 0.22) 0%, rgba(88, 101, 242, 0.06) 50%, transparent 75%)",
        }}
      />

      {/* 5. 环境极光光晕 2 (右下方：冷青与暗紫过渡静态光晕，零 GPU 动画开销) */}
      <div
        data-testid="auth-bg-ambient-orb-secondary"
        className="absolute -bottom-36 -right-32 w-[600px] h-[600px] rounded-full blur-[130px] opacity-90"
        style={{
          background:
            "radial-gradient(circle, rgba(0, 176, 244, 0.14) 0%, rgba(88, 101, 242, 0.08) 45%, transparent 75%)",
        }}
      />

      {/* 6. 卡片居中背光 (为登录/注册卡片提供细腻深邃的轮廓反衬光) */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[460px] h-[460px] rounded-full blur-[100px] opacity-40 pointer-events-none"
        style={{
          background:
            "radial-gradient(circle, rgba(88, 101, 242, 0.15) 0%, transparent 70%)",
        }}
      />
    </div>
  );
};
