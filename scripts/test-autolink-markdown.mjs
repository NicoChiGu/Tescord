import assert from "node:assert/strict";
import {
  extractBalancedAutolink,
  AUTOLINK_CANDIDATE_REGEX,
  MARKDOWN_LINK_REGEX,
} from "../apps/web/src/utils/url.js";

console.log("🚀 开始验证 URL 自动链接与 Markdown 解析算法 (GFM Balanced)...");

// 1. Tarkov Wiki 包含闭括号词条测试
{
  const rawCandidate =
    "https://escapefromtarkov.fandom.com/wiki/Spiritus_Systems_LV-119_Plate_Carrier_(Black_Division_V1)";
  const extracted = extractBalancedAutolink(rawCandidate);
  assert.equal(
    extracted,
    "https://escapefromtarkov.fandom.com/wiki/Spiritus_Systems_LV-119_Plate_Carrier_(Black_Division_V1)",
    "应完整保留 URL 自带的末尾闭括号",
  );
  console.log("✓ 测试 1 通过：Tarkov Wiki 词条自带末尾闭括号完整保留");
}

// 2. 中文全角括号【】包裹测试
{
  const text =
    "【https://escapefromtarkov.fandom.com/wiki/Spiritus_Systems_LV-119_Plate_Carrier_(Black_Division_V1)】";
  // 模拟 parseInline 遇到【后，进入下一次循环 remaining 截取到的 http 开头候选串
  const candidate = text.slice(1);
  const match = candidate.match(AUTOLINK_CANDIDATE_REGEX);
  assert.ok(match, "应当匹配到候选 URL 字符串");
  const extracted = extractBalancedAutolink(match[1]);
  assert.equal(
    extracted,
    "https://escapefromtarkov.fandom.com/wiki/Spiritus_Systems_LV-119_Plate_Carrier_(Black_Division_V1)",
    "应剥离末尾的中文右方头括号【】，同时保留 URL 内部的闭括号",
  );
  console.log("✓ 测试 2 通过：中文全角括号【】包裹时，正确剥离【】，保留内部闭括号");
}

// 3. 英文普通圆括号包裹测试
{
  const text = "(https://example.com/test_(tag))";
  // 模拟状态机提取 candidate
  const candidate = "https://example.com/test_(tag))";
  const extracted = extractBalancedAutolink(candidate);
  assert.equal(
    extracted,
    "https://example.com/test_(tag)",
    "应剥离外层多余的闭括号，保留内部成对括号",
  );
  console.log("✓ 测试 3 通过：外层圆括号包裹时，正确剥离外层闭括号");
}

// 4. 中文标点（句号、逗号、感叹号）结尾测试
{
  const tests = [
    { input: "https://example.com/test。", expected: "https://example.com/test" },
    { input: "https://example.com/test，", expected: "https://example.com/test" },
    { input: "https://example.com/test！", expected: "https://example.com/test" },
    { input: "https://example.com/test？", expected: "https://example.com/test" },
    { input: "https://example.com/test》", expected: "https://example.com/test" },
    { input: "https://example.com/test”", expected: "https://example.com/test" },
  ];
  for (const { input, expected } of tests) {
    const extracted = extractBalancedAutolink(input);
    assert.equal(extracted, expected, `应正确剥离尾随中文标点: ${input}`);
  }
  console.log("✓ 测试 4 通过：中日韩全角标点符号（。，！？》”）全部成功剥离");
}

// 5. 英文标点（句号、逗号、感叹号、问号）结尾测试
{
  const tests = [
    { input: "https://example.com/test.", expected: "https://example.com/test" },
    { input: "https://example.com/test,", expected: "https://example.com/test" },
    { input: "https://example.com/test!", expected: "https://example.com/test" },
    { input: "https://example.com/test?", expected: "https://example.com/test" },
    { input: "https://example.com/test;", expected: "https://example.com/test" },
  ];
  for (const { input, expected } of tests) {
    const extracted = extractBalancedAutolink(input);
    assert.equal(extracted, expected, `应正确剥离尾随英文标点: ${input}`);
  }
  console.log("✓ 测试 5 通过：英文半角标点符号全部成功剥离");
}

// 6. Markdown 格式带括号超链接测试
{
  const markdownText =
    "[Spiritus LV-119](https://escapefromtarkov.fandom.com/wiki/Spiritus_Systems_LV-119_Plate_Carrier_(Black_Division_V1))";
  const match = markdownText.match(MARKDOWN_LINK_REGEX);
  assert.ok(match, "应当匹配 Markdown 超链接");
  assert.equal(match[1], "Spiritus LV-119", "链接文本应当正确捕获");
  assert.equal(
    match[2],
    "https://escapefromtarkov.fandom.com/wiki/Spiritus_Systems_LV-119_Plate_Carrier_(Black_Division_V1)",
    "链接 URL 应当包含完整的嵌套括号，不提前截断",
  );
  console.log("✓ 测试 6 通过：Markdown 链接语法 [text](url) 完美支持 URL 嵌套括号");
}

// 7. 多层嵌套括号测试
{
  const nested = "https://example.com/wiki/A_(B_(C))";
  const extracted = extractBalancedAutolink(nested);
  assert.equal(extracted, "https://example.com/wiki/A_(B_(C))");

  const mdNested = "[Deep](https://example.com/wiki/A_(B_(C)))";
  const mdMatch = mdNested.match(MARKDOWN_LINK_REGEX);
  assert.ok(mdMatch);
  assert.equal(mdMatch[2], "https://example.com/wiki/A_(B_(C))");
  console.log("✓ 测试 7 通过：多层嵌套括号均可正确解析");
}

console.log("🎉 全部 7 组 URL 与 Markdown 单元测试 100% 通过！");
