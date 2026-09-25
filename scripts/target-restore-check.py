#!/usr/bin/env python3
"""Verify an isolated PostgreSQL + MinIO restore without revealing credentials."""

import argparse
import json
import re
import subprocess
import urllib.parse


parser = argparse.ArgumentParser()
parser.add_argument("--state", required=True)
parser.add_argument("--env-file", required=True)
args = parser.parse_args()

with open(args.state, encoding="utf-8") as file:
    state = json.load(file)

for name in ("guildId", "channelId", "messageId"):
    if not re.fullmatch(r"[a-zA-Z0-9_-]+", state[name]):
        raise RuntimeError(f"invalid {name} in acceptance state")
if not re.fullmatch(r"[a-zA-Z0-9_.@-]+", state["email"]):
    raise RuntimeError("invalid email in acceptance state")

sql = (
    'SELECT (SELECT COUNT(*) FROM "User" WHERE email=\'' + state["email"] + '\'), '
    '(SELECT COUNT(*) FROM "Guild" WHERE id=\'' + state["guildId"] + '\'), '
    '(SELECT COUNT(*) FROM "Channel" WHERE id=\'' + state["channelId"] + '\'), '
    '(SELECT COUNT(*) FROM "Message" WHERE id=\'' + state["messageId"] + '\')'
)
counts = subprocess.check_output([
    "podman", "exec", "tescord-restore-pg", "psql", "-U", "tescord",
    "-d", "tescord_restore", "-Atc", sql
], text=True).strip()
if counts != "1|1|1|1":
    raise RuntimeError("restored PostgreSQL records differ: " + counts)
print("PASS restored user, guild, channel and message: 1 each")

url = urllib.parse.urlsplit(state["attachmentUrl"])
file_key = urllib.parse.unquote(url.path.rsplit("/", 1)[-1])
if not re.fullmatch(r"[a-zA-Z0-9_.-]+", file_key):
    raise RuntimeError("invalid attachment key")
curl = (
    'curl --fail --silent --show-error '
    '--aws-sigv4 "aws:amz:us-east-1:s3" '
    '-u "$MINIO_ROOT_USER:$MINIO_ROOT_PASSWORD" '
    '"http://tescord-restore-minio:9000/tescord-assets/$FILE_KEY" '
    '-o /tmp/restored-attachment && sha256sum /tmp/restored-attachment'
)
result = subprocess.check_output([
    "podman", "run", "--rm", "--network", "docker_default",
    "--env-file", args.env_file, "-e", "FILE_KEY=" + file_key,
    "localhost/docker_server:latest", "sh", "-c", curl
], text=True).strip()
actual = result.split()[0]
if actual != state["attachmentSha256"]:
    raise RuntimeError("restored MinIO attachment hash differs")
print("PASS restored MinIO attachment SHA256 matches")
