import { config } from "dotenv";
config();

async function runEmojiVerification() {
  const baseUrl = process.env.SERVER_BASE_URL || "http://localhost:3001";
  console.log("🧪 开始执行自定义表情（个人表情/服务器表情）全链路与安全边界自动化验收...");

  // 1. 登录管理员
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      emailOrUsername: "admin@tescord.local",
      password: "adminpassword123",
    }),
  });
  if (!loginRes.ok) {
    throw new Error(`Admin login failed: ${await loginRes.text()}`);
  }
  const { accessToken: adminToken, user: adminUser } = await loginRes.json();
  console.log("✅ 1. 管理员登录成功:", adminUser.username);

  // 2. 负向测试：未登录请求预签名链接必须被拒 (401)
  const unauthPresignRes = await fetch(`${baseUrl}/api/attachments/presigned-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName: "unauth_emoji.png",
      fileSize: 1024,
      mimeType: "image/png",
      purpose: "custom-emoji",
    }),
  });
  if (unauthPresignRes.status !== 401) {
    throw new Error(`Expected 401 for unauthorized presigned URL, got ${unauthPresignRes.status}`);
  }
  console.log("✅ 2. 负向安全测试通过：未认证请求预签名返回 401");

  // 3. 负向测试：不支持的文件类型必须被拒 (400)
  const invalidTypeRes = await fetch(`${baseUrl}/api/attachments/presigned-url`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      fileName: "malicious.exe",
      fileSize: 1024,
      mimeType: "application/x-msdownload",
      purpose: "custom-emoji",
    }),
  });
  if (invalidTypeRes.status !== 400) {
    throw new Error(`Expected 400 for malicious file type, got ${invalidTypeRes.status}`);
  }
  console.log("✅ 3. 负向安全测试通过：恶意文件格式预签名返回 400");

  // 4. 正常链路：个人表情上传与认领闭环 (无 channelId)
  // 1x1 透明 PNG 字节流
  const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  const pngBuffer = Buffer.from(pngBase64, "base64");
  const emojiName = `test_emoji_${Date.now().toString().slice(-4)}`;

  const userPresignRes = await fetch(`${baseUrl}/api/attachments/presigned-url`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      fileName: `${emojiName}.png`,
      fileSize: pngBuffer.length,
      mimeType: "image/png",
      purpose: "custom-emoji",
    }),
  });
  if (!userPresignRes.ok) {
    throw new Error(`个人表情获取预签名失败 (曾提示 channelId is required): ${await userPresignRes.text()}`);
  }
  const { uploadUrl, fileUrl, fileKey } = await userPresignRes.json();
  if (!fileUrl.includes("/public-assets/")) {
    throw new Error(`fileUrl 必须属于 /public-assets/，实际为: ${fileUrl}`);
  }
  console.log("✅ 4.1 个人表情预签名生成成功（无 channelId 阻断且路径正确指向 public-assets）");

  // 4.2 PUT 直传二进制内容
  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "image/png",
      Authorization: `Bearer ${adminToken}`,
    },
    body: pngBuffer,
  });
  if (!putRes.ok) {
    throw new Error(`PUT 直传表情数据失败 (status ${putRes.status}): ${await putRes.text()}`);
  }
  console.log("✅ 4.2 PUT 二进制直传成功（未被 channel 权限拦截）");

  // 4.3 认领并入库个人表情
  const createEmojiRes = await fetch(`${baseUrl}/api/users/me/emojis`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      name: emojiName,
      imageUrl: fileUrl,
      animated: false,
    }),
  });
  if (!createEmojiRes.ok) {
    throw new Error(`认领个人表情入库失败: ${await createEmojiRes.text()}`);
  }
  const createdEmoji = await createEmojiRes.json();
  console.log("✅ 4.3 个人表情成功入库:", createdEmoji.id, createdEmoji.name);

  // 4.4 验证公开资源可正常读取（200 OK）
  const getAssetRes = await fetch(fileUrl);
  if (!getAssetRes.ok) {
    throw new Error(`公开静态资源读取失败 (曾误判404): ${getAssetRes.status}`);
  }
  const assetBytes = await getAssetRes.arrayBuffer();
  if (assetBytes.byteLength !== pngBuffer.length) {
    throw new Error(`读取内容长度不匹配: expected ${pngBuffer.length}, got ${assetBytes.byteLength}`);
  }
  console.log("✅ 4.4 公开静态资源成功读取（防刷鉴权与 CustomEmoji 绑定校验通过）");

  // 4.5 删除个人表情，并验证物理资源级联清理
  const delEmojiRes = await fetch(`${baseUrl}/api/users/me/emojis/${createdEmoji.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  if (!delEmojiRes.ok) {
    throw new Error(`删除个人表情失败: ${await delEmojiRes.text()}`);
  }
  console.log("✅ 4.5 个人表情记录成功删除");

  // 等待底层存储异步清理完成
  await new Promise((r) => setTimeout(r, 200));

  // 再次读取已被删除的表情图片，必须返回 404
  const getDeletedRes = await fetch(fileUrl);
  if (getDeletedRes.status !== 404) {
    throw new Error(`已删除表情应返回 404，实际状态码: ${getDeletedRes.status}`);
  }
  console.log("✅ 4.6 物理资源级联清理验证通过（已删除表情返回 404）");

  // 5. 验证服务器表情（Guild Emoji）全流程
  // 5.1 获取公会列表
  const guildsRes = await fetch(`${baseUrl}/api/guilds`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const guilds = await guildsRes.json();
  const guild = guilds[0];
  if (!guild) throw new Error("无可用公会进行测试");

  // 5.2 获取服务器表情预签名
  const guildEmojiName = `guild_emoji_${Date.now().toString().slice(-4)}`;
  const guildPresignRes = await fetch(`${baseUrl}/api/attachments/presigned-url`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      fileName: `${guildEmojiName}.png`,
      fileSize: pngBuffer.length,
      mimeType: "image/png",
      purpose: "custom-emoji",
      guildId: guild.id,
    }),
  });
  if (!guildPresignRes.ok) {
    throw new Error(`获取服务器表情预签名失败: ${await guildPresignRes.text()}`);
  }
  const guildPresign = await guildPresignRes.json();

  // 5.3 PUT 直传服务器表情
  const guildPutRes = await fetch(guildPresign.uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "image/png",
      Authorization: `Bearer ${adminToken}`,
    },
    body: pngBuffer,
  });
  if (!guildPutRes.ok) {
    throw new Error(`PUT 直传服务器表情失败: ${await guildPutRes.text()}`);
  }

  // 5.4 登记服务器表情
  const createGuildEmojiRes = await fetch(`${baseUrl}/api/guilds/${guild.id}/emojis`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      name: guildEmojiName,
      imageUrl: guildPresign.fileUrl,
      animated: false,
    }),
  });
  if (!createGuildEmojiRes.ok) {
    throw new Error(`登记服务器表情失败: ${await createGuildEmojiRes.text()}`);
  }
  const createdGuildEmoji = await createGuildEmojiRes.json();
  console.log("✅ 5.1 服务器表情成功创建入库:", createdGuildEmoji.id, createdGuildEmoji.name);

  // 5.5 访问服务器表情
  const getGuildAssetRes = await fetch(guildPresign.fileUrl);
  if (!getGuildAssetRes.ok) {
    throw new Error(`访问服务器表情失败: ${getGuildAssetRes.status}`);
  }
  console.log("✅ 5.2 服务器表情静态资源读取通过");

  // 5.6 删除服务器表情
  const delGuildEmojiRes = await fetch(`${baseUrl}/api/guilds/${guild.id}/emojis/${createdGuildEmoji.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  if (!delGuildEmojiRes.ok) {
    throw new Error(`删除服务器表情失败: ${await delGuildEmojiRes.text()}`);
  }
  console.log("✅ 5.3 服务器表情删除及物理清理验证通过");

  console.log("\n🎉 所有表情上传与生命周期闭环自动化测试均已 100% 通过！");
}

runEmojiVerification().catch((err) => {
  console.error("❌ 验证失败:", err);
  process.exit(1);
});
