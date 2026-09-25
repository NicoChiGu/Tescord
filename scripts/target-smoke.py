#!/usr/bin/env python3
"""Small isolated target-host smoke test; prints no credentials or tokens."""

import argparse
import hashlib
import json
import os
import secrets
import urllib.error
import urllib.parse
import urllib.request


def call(base, method, path, token=None, data=None, raw=False):
    if path.startswith("http"):
        parsed = urllib.parse.urlsplit(path)
        path = urllib.parse.urlunsplit(("", "", parsed.path, parsed.query, ""))
    url = base.rstrip("/") + path
    headers = {}
    if token:
        headers["Authorization"] = "Bearer " + token
    if data is not None and not raw:
        data = json.dumps(data).encode()
        headers["Content-Type"] = "application/json"
    elif raw:
        headers["Content-Type"] = "text/plain"
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            body = response.read()
            mime = response.headers.get("Content-Type", "")
            return response.status, json.loads(body) if "json" in mime else body
    except urllib.error.HTTPError as error:
        body = error.read()
        try:
            body = json.loads(body)
        except ValueError:
            pass
        return error.code, body


def require(status, wanted, body, label):
    if status != wanted:
        raise RuntimeError(f"{label}: expected {wanted}, got {status}")
    print(f"PASS {label}: HTTP {status}")


def run(base, state_path, verify):
    if verify:
        with open(state_path, encoding="utf-8") as file:
            state = json.load(file)
        status, auth = call(base, "POST", "/api/auth/login", data={
            "emailOrUsername": state["email"], "password": state["password"]
        })
        require(status, 200, auth, "login after restart")
        token = auth["accessToken"]
        status, guilds = call(base, "GET", "/api/guilds", token)
        require(status, 200, guilds, "guild listing after restart")
        if state["guildId"] not in json.dumps(guilds):
            raise RuntimeError("created guild missing after restart")
        print("PASS guild persisted")
        status, messages = call(base, "GET", f'/api/channels/{state["channelId"]}/messages', token)
        require(status, 200, messages, "messages persisted")
        if state["messageId"] not in json.dumps(messages):
            raise RuntimeError("created message missing after restart")
        print("PASS message persisted")
        status, attachment = call(base, "GET", state["attachmentUrl"], token)
        require(status, 200, attachment, "attachment persisted")
        if hashlib.sha256(attachment).hexdigest() != state["attachmentSha256"]:
            raise RuntimeError("attachment hash differs")
        print("PASS attachment SHA256 matches")
        return

    marker = secrets.token_hex(5)
    email = f"preprod-{marker}@example.invalid"
    password = secrets.token_urlsafe(24)
    status, auth = call(base, "POST", "/api/auth/register", data={
        "username": "preprod_" + marker, "email": email, "password": password
    })
    require(status, 200, auth, "register")
    token = auth["accessToken"]
    refresh = auth["refreshToken"]
    status, _ = call(base, "GET", "/api/guilds", None)
    require(status, 401, _, "anonymous guild denial")
    status, guild = call(base, "POST", "/api/guilds", token, {"name": "Preprod " + marker})
    require(status, 200, guild, "create guild")
    guild_id = guild["id"]
    status, channel = call(base, "POST", f"/api/guilds/{guild_id}/channels", token, {
        "name": "acceptance", "type": "TEXT"
    })
    require(status, 200, channel, "create channel")
    channel_id = channel["id"]
    content = b"Tescord MinIO acceptance bytes\n"
    status, grant = call(base, "POST", "/api/attachments/presigned-url", token, {
        "fileName": "preprod.txt", "fileSize": len(content),
        "mimeType": "text/plain", "channelId": channel_id
    })
    require(status, 200, grant, "attachment grant")
    status, _ = call(base, "PUT", grant["uploadUrl"], token, content, raw=True)
    require(status, 200, _, "attachment upload")
    status, message = call(base, "POST", f"/api/channels/{channel_id}/messages", token, {
        "content": "Preprod target smoke " + marker,
        "attachments": [{"url": grant["fileUrl"], "fileName": "preprod.txt",
                         "fileSize": len(content), "mimeType": "text/plain"}]
    })
    require(status, 200, message, "post message with attachment")
    attachment_url = message["attachments"][0]["url"]
    status, _ = call(base, "GET", "/attachments/" + grant["fileKey"])
    require(status, 403, _, "unsigned attachment denial")
    tampered = urllib.parse.urlsplit(attachment_url)
    query = urllib.parse.parse_qs(tampered.query)
    query["signature"] = ["tampered"]
    bad_url = urllib.parse.urlunsplit((tampered.scheme, tampered.netloc, tampered.path,
                                      urllib.parse.urlencode(query, doseq=True), ""))
    status, _ = call(base, "GET", bad_url, token)
    require(status, 403, _, "tampered attachment denial")
    status, rotated = call(base, "POST", "/api/auth/refresh", data={"refreshToken": refresh})
    require(status, 200, rotated, "refresh rotation")
    status, _ = call(base, "POST", "/api/auth/refresh", data={"refreshToken": refresh})
    require(status, 401, _, "consumed refresh denial")
    state = {"email": email, "password": password, "guildId": guild_id,
             "channelId": channel_id, "messageId": message["id"],
             "attachmentUrl": attachment_url,
             "attachmentSha256": hashlib.sha256(content).hexdigest()}
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    fd = os.open(state_path, flags, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as file:
        json.dump(state, file)
    print("PASS acceptance state saved with mode 0600")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:18080")
    parser.add_argument("--state", required=True)
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    run(args.base, args.state, args.verify)
