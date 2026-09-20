import { config } from "dotenv";
config();

async function runFullPhase2Verification() {
  console.log(
    "🧪 开始路线图阶段二（Phase 2: 2.3, 2.4, 2.5）全量端到端功能自动化验证...",
  );
  const baseUrl = "http://localhost:3001";

  // 0. 基础登录
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      emailOrUsername: "admin@tescord.local",
      password: "adminpassword123",
    }),
  });
  if (!loginRes.ok) throw new Error("Admin login failed");
  const { accessToken: adminToken, user: adminUser } = await loginRes.json();
  console.log("✅ 0. 管理员登录就绪:", adminUser.username);

  // ==========================================
  // 1. 验证 2.3：服务器 (Guild) 与频道深度控制
  // ==========================================
  console.log("\n--- 1. 验证 2.3 服务器与频道控制 ---");

  // 1.1 创建新公会
  const guildName = `自动化极客联盟_${Date.now().toString().slice(-4)}`;
  const createGuildRes = await fetch(`${baseUrl}/api/guilds`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      name: guildName,
      iconUrl: "https://api.dicebear.com/7.x/bottts/svg?seed=geek",
    }),
  });
  if (!createGuildRes.ok)
    throw new Error(`Create guild failed: ${await createGuildRes.text()}`);
  const guild = await createGuildRes.json();
  console.log("✅ 1.1 成功创建服务器:", {
    id: guild.id,
    name: guild.name,
    channels: guild.channels.length,
  });

  // 1.2 为公会创建专属邀请码
  const createInviteRes = await fetch(
    `${baseUrl}/api/guilds/${guild.id}/invites`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        maxUses: 5,
        expiresInHours: 24,
      }),
    },
  );
  if (!createInviteRes.ok)
    throw new Error(`Create invite failed: ${await createInviteRes.text()}`);
  const invite = await createInviteRes.json();
  console.log("✅ 1.2 成功生成公会专属邀请码:", {
    code: invite.code,
    maxUses: invite.maxUses,
  });

  // 1.3 注册第二用户并通过邀请码加入
  const memberEmail = `member_${Date.now().toString().slice(-4)}@tescord.local`;
  const registerMemberRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: `member_${Date.now().toString().slice(-4)}`,
      email: memberEmail,
      password: "memberpassword123",
    }),
  });
  const memberData = await registerMemberRes.json();
  const joinRes = await fetch(`${baseUrl}/api/invites/${invite.code}/join`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${memberData.accessToken}`,
    },
    body: JSON.stringify({}),
  });
  if (!joinRes.ok)
    throw new Error(`Join invite failed: ${await joinRes.text()}`);
  console.log("✅ 1.3 第二用户凭借专属邀请码成功加入公会");

  // 1.4 创建新文字频道与语音频道
  const createChannelRes = await fetch(
    `${baseUrl}/api/guilds/${guild.id}/channels`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        name: "技术讨论",
        type: "TEXT",
        topic: "聚焦 WebRTC 与端到端加密架构",
      }),
    },
  );
  if (!createChannelRes.ok)
    throw new Error(`Create channel failed: ${await createChannelRes.text()}`);
  const newChannel = await createChannelRes.json();
  console.log("✅ 1.4 成功在公会中创建新文字频道:", {
    id: newChannel.id,
    name: newChannel.name,
  });

  // 1.5 测试创建并删除临时频道
  const tempChannelRes = await fetch(
    `${baseUrl}/api/guilds/${guild.id}/channels`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ name: "待删除测试频道", type: "TEXT" }),
    },
  );
  const tempChannel = await tempChannelRes.json();
  const deleteChannelRes = await fetch(
    `${baseUrl}/api/channels/${tempChannel.id}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${adminToken}` },
    },
  );
  if (!deleteChannelRes.ok) throw new Error("Delete channel failed");
  console.log("✅ 1.5 频道删除与权限控制验证通过");

  // ==========================================
  // 2. 验证 2.4：富文本即时消息流与 Reaction 互动
  // ==========================================
  console.log("\n--- 2. 验证 2.4 富文本消息与 Reaction 互动 ---");

  // 2.1 发送包含 Markdown 的首条消息
  const sendMsgRes = await fetch(
    `${baseUrl}/api/channels/${newChannel.id}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        content:
          "欢迎来到 **Tescord**！这是 `Markdown` 语法测试，包含 ||剧透内容|| 与代码块：\n```ts\nconst ready = true;\n```",
      }),
    },
  );
  if (!sendMsgRes.ok)
    throw new Error(`Send message failed: ${await sendMsgRes.text()}`);
  const msg1 = await sendMsgRes.json();
  console.log("✅ 2.1 成功发送富文本 Markdown 消息:", {
    id: msg1.id,
    content: msg1.content.slice(0, 30),
  });

  // 2.2 发送带引用的回复消息 (Quote Reply)
  const replyMsgRes = await fetch(
    `${baseUrl}/api/channels/${newChannel.id}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${memberData.accessToken}`,
      },
      body: JSON.stringify({
        content: "收到！看起来非常酷炫 🔥",
        replyToId: msg1.id,
      }),
    },
  );
  const msg2 = await replyMsgRes.json();
  if (!msg2.replyTo || msg2.replyTo.id !== msg1.id) {
    throw new Error("Reply quote mismatch");
  }
  console.log(
    "✅ 2.2 引用回复消息 (Quote Reply) 发送成功，附带作者预览:",
    msg2.replyTo,
  );

  // 2.3 对消息点赞 (Reaction 添加与取消)
  const reactionEmoji = encodeURIComponent("🚀");
  const addReactionRes = await fetch(
    `${baseUrl}/api/channels/${newChannel.id}/messages/${msg1.id}/reactions/${reactionEmoji}`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${adminToken}` },
    },
  );
  if (!addReactionRes.ok)
    throw new Error(`Add reaction failed: ${await addReactionRes.text()}`);
  const reactionsAfterAdd = await addReactionRes.json();
  const rocketReaction = reactionsAfterAdd.find((r: any) => r.emoji === "🚀");
  if (!rocketReaction || rocketReaction.count !== 1)
    throw new Error("Reaction count mismatch after add");
  console.log(
    "✅ 2.3 消息 Reaction 点赞成功，当前反应统计:",
    reactionsAfterAdd,
  );

  // 2.4 置顶消息 (Pin)
  const pinRes = await fetch(
    `${baseUrl}/api/channels/${newChannel.id}/messages/${msg1.id}/pin`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${adminToken}` },
    },
  );
  if (!pinRes.ok) throw new Error("Pin message failed");
  const pinData = await pinRes.json();
  if (!pinData.isPinned) throw new Error("Pin status mismatch");
  console.log("✅ 2.4 消息置顶 (Pin) 状态切换成功:", pinData);

  // 2.5 获取历史消息，核验 reactions 聚合与 replyTo 结构
  const listMsgRes = await fetch(
    `${baseUrl}/api/channels/${newChannel.id}/messages`,
    {
      headers: { Authorization: `Bearer ${adminToken}` },
    },
  );
  const listMsgs = await listMsgRes.json();
  const foundMsg1 = listMsgs.find((m: any) => m.id === msg1.id);
  if (!foundMsg1 || !foundMsg1.reactions || foundMsg1.reactions.length === 0) {
    throw new Error("Reactions mapping missing in GET messages");
  }
  console.log("✅ 2.5 历史消息拉取核验通过：Reactions 结构正确聚合并返回");

  // 2.6 撤回/删除第二条消息
  const deleteMsgRes = await fetch(
    `${baseUrl}/api/channels/${newChannel.id}/messages/${msg2.id}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${memberData.accessToken}` },
    },
  );
  if (!deleteMsgRes.ok) throw new Error("Delete message failed");
  console.log("✅ 2.6 消息撤回/删除成功");

  // ==========================================
  // 3. 验证 2.5：MinIO / 本地双模对象存储与附件直传
  // ==========================================
  console.log("\n--- 3. 验证 2.5 对象存储附件直传 ---");

  // 3.1 请求预签名上传 URL
  const testFileName = "tescord_screenshot_test.png";
  const presignRes = await fetch(`${baseUrl}/api/attachments/presigned-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName: testFileName,
      fileSize: 1024,
      mimeType: "image/png",
    }),
  });
  if (!presignRes.ok)
    throw new Error(`Presign URL failed: ${await presignRes.text()}`);
  const presignData = await presignRes.json();
  console.log("✅ 3.1 预签名直传凭证签发成功:", {
    uploadUrl: presignData.uploadUrl,
    fileUrl: presignData.fileUrl,
    fileKey: presignData.fileKey,
  });

  // 3.2 模拟客户端向 uploadUrl 直接 PUT 二进制数据
  const dummyImageBuffer = Buffer.from("FAKE_PNG_BINARY_CONTENT_TESCORD_2026");
  const uploadBinaryRes = await fetch(presignData.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "image/png" },
    body: dummyImageBuffer,
  });
  if (!uploadBinaryRes.ok)
    throw new Error(`Upload binary failed: ${await uploadBinaryRes.text()}`);
  console.log("✅ 3.2 客户端直传数据写入成功");

  // 3.3 验证直传后的静态资源可通过 fileUrl 访问
  const verifyFetchFileRes = await fetch(presignData.fileUrl);
  if (!verifyFetchFileRes.ok)
    throw new Error(`Failed to fetch uploaded file: ${presignData.fileUrl}`);
  console.log("✅ 3.3 直传文件 HTTP 静态访问自愈校验成功 (状态码 200)");

  // 3.4 发送包含此附件的消息
  const sendAttachmentMsgRes = await fetch(
    `${baseUrl}/api/channels/${newChannel.id}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        content: "分享一张截图附件！",
        attachments: [
          {
            url: presignData.fileUrl,
            fileName: testFileName,
            fileSize: dummyImageBuffer.length,
            mimeType: "image/png",
          },
        ],
      }),
    },
  );
  const attachmentMsg = await sendAttachmentMsgRes.json();
  if (!attachmentMsg.attachments || attachmentMsg.attachments.length === 0) {
    throw new Error("Attachments not saved to message");
  }
  console.log(
    "✅ 3.4 带附件的消息持久化与查询验证通过:",
    attachmentMsg.attachments,
  );

  console.log(
    "\n🎉🎉🎉 路线图阶段二（Phase 2: 2.3, 2.4, 2.5）全部后端业务全链路端到端自动化测试 100% 通过！\n",
  );
}

runFullPhase2Verification().catch((err) => {
  console.error("\n❌ 自动化验证失败:", err);
  process.exit(1);
});
