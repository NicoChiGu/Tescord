# Handoff Report - Explorer 3

## 1. Observation

1. **图片加载与骨架屏实现**：
   - 文件：`apps/web/src/components/chat/ImageAttachment.tsx`，L150-163 骨架屏渲染：
     ```tsx
     {
       status === "loading" && (
         <div
           data-testid="image-skeleton"
           style={{ width: "100%", height: "100%" }}
           className="relative bg-[#2b2d31] animate-pulse overflow-hidden flex flex-col items-center justify-center text-discord-textMuted/40"
         >
           <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.6s_infinite] bg-gradient-to-r from-transparent via-white/5 to-transparent pointer-events-none" />
           ...
         </div>
       );
     }
     ```
   - L223-250 图片挂载：
     ```tsx
     className={status === "loaded" ? "block w-full h-full" : "absolute opacity-0 pointer-events-none w-full h-full"}
     ```
     在 `onLoad` 时 `setStatus("loaded")`，骨架屏瞬时销毁，图片瞬间切换为不透明，缺乏淡入过渡。

2. **Lightbox 预览实现与路径勘误**：
   - 实际文件位于 `apps/web/src/components/chat/LightboxModal.tsx`（而非 `components/modals/`）；
   - L794-851 原图加载反馈：
     ```tsx
     <div data-testid="lightbox-load-status" role="status" aria-live="polite" className="absolute bottom-16 left-1/2 -translate-x-1/2 max-w-[90vw] bg-black/80 rounded-lg px-4 py-3 text-sm text-white flex flex-col gap-2" ...>
     ```
     采用原生 HTML `<progress>` 位于底部角落；原图加载后 L221 直接调用 `setImageUrl(objectUrl)` 发生单图层直接置换；原图 HD 状态在工具栏仅为 disabled 普通按钮。

3. **国际化 5 语言包现状**：
   - 路径：`apps/web/src/i18n/locales/{zh-CN, zh-TW, zh-HK, en-US, ja-JP}/`；
   - 5 个语言目录均完整存在且对称包含 10 个业务域 JSON（`common.json`, `voice.json`, `chat.json`, `modals.json`, `settings.json`, `errors.json`, `admin.json`, `auth.json`, `contextMenu.json`, `server.json`）；
   - `voice.json` L148 包含伴音混音器词条 `"mixPanel": "声卡伴音与麦克风混音控制面板"`（需清理）；
   - 发现 4 处硬编码中文：
     - `NetworkQualityModal.tsx:610`：`${peerLatencies.size} 节点`；
     - `NetworkQualityModal.tsx:708`：`点对点独立 RTT`；
     - `VoiceRoomArea.tsx:498`：`切换`；
     - `VoiceRoomArea.tsx:2949-2980`：伴音混音控制台弹窗中文（按 R5 移除）。

4. **测试工程现状**：
   - 根目录 `package.json` 未安装 `vitest` 依赖；
   - 项目标准单测机制为 TypeScript 脚本（`scripts/test-*.ts`）运行于 `node:test` + `node:assert/strict`；
   - 验证命令 `pnpm --filter @tescord/server exec tsx ../../scripts/test-channel-nav-store.ts` 耗时 4 秒顺利通过；
   - E2E 体系基于 Playwright（`playwright.config.ts`），包含 128 个 spec 文件，已具备 `e2e/chat-image-skeleton.spec.ts` 与 `e2e/lightbox-interaction-and-download.spec.ts`。

## 2. Logic Chain

1. 基于 Observation 1，`ImageAttachment.tsx` 之所以没有淡入过渡，是因为骨架屏容器直接受条件渲染控制，在 `loaded` 状态下立即从 DOM 中卸载，且真实图片直接变更为可见块级元素；推导改造方案：使骨架屏与真实图片分层绝对定位，真实图片采用 `transition-opacity duration-300` 渐变显现，骨架屏渐隐淡出，平滑消除画面闪变。
2. 基于 Observation 2，`LightboxModal.tsx` 当前的进度条位于底部，未能吸引用户视觉焦点；推导改造方案：将 `data-testid="lightbox-load-status"` 移至画面正中心并升级为毛玻璃卡片中的 SVG 环形进度条，原图就绪后使用双图层交叉渐隐（cross-fade），并将右上角工具栏的原图按钮升级为点亮的绿色 HD 徽章。
3. 基于 Observation 3，系统遵循 AGENTS.md 强约束，新增与清理词条必须保持 5 语言 100% 对称；梳理出 9 个需要新增的键名（涵盖 Popover 拓扑指标、看板直连 IP、HD 徽章）及伴音废弃键名，并在所有 5 套语言包中完整对齐。
4. 基于 Observation 4，项目虽有 Vitest 角色定义但尚未引入包依赖，当前所有核心逻辑均通过 `scripts/test-*.ts` 完成单测；推导方案：在 `scripts/test-p2p-ip-classification.ts` 中编写专职 IP 分类算法单测，并复用现有 Playwright 用例保证 R6 与全链路验收。

## 3. Caveats

1. `LightboxModal.tsx` 位于 `apps/web/src/components/chat/`，若后续开发人员按需求文档在 `modals/` 寻找将无法定位或可能创建重复文件。
2. 重构骨架屏和 Lightbox 模态框时，不得移除现有的 `data-testid="image-skeleton"` 与 `data-testid="lightbox-load-status"`，否则会导致 Playwright E2E 现有测试断言失败。

## 4. Conclusion

R6 图片加载淡入与 Lightbox 居中毛玻璃环形进度重构方案已完全明确；R7 涉及的 5 套语言包（zh-CN, zh-TW, zh-HK, en-US, ja-JP）全部词条已完成矩阵梳理且无漏键风险；单测与 E2E 自动化测试验证路径已跑通并制定完整方案。全部详尽分析已沉淀至工作目录下的 `report.md`。

## 5. Verification Method

1. **查看完整报告文件**：
   - 路径：`e:\nodejs_project\Tescord\.agents\teamwork\explorer_survey_3\report.md`
2. **测试环境验证命令**：
   - 运行现存单测机制：
     ```bash
     pnpm --filter @tescord/server exec tsx ../../scripts/test-channel-nav-store.ts
     ```
   - 运行相关 Playwright E2E 用例：
     ```bash
     npx playwright test e2e/chat-image-skeleton.spec.ts e2e/lightbox-interaction-and-download.spec.ts
     ```
