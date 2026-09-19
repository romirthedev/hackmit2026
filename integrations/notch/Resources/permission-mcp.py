#!/usr/bin/env python3
"""Stdio MCP server bridging Claude Code permission prompts to Notch.

Claude Code (headless) is launched with --permission-prompt-tool pointing at
this server's `approve` tool. Every privileged tool call lands here; we POST
it to Notch's local remote-control server, which applies saved rules or shows
the Allow Once / Always Allow / Deny card in the notch panel, and we return
Claude Code's expected {"behavior": "allow"|"deny"} payload.

Stdlib-only; no dependencies.
"""
import json
import pathlib
import sys
import urllib.request


def token() -> str:
    return (pathlib.Path.home() / ".notch" / "remote-token").read_text().strip()


def ask_notch(tool_name: str, tool_input) -> dict:
    body = json.dumps({"tool_name": tool_name, "input": tool_input}).encode()
    req = urllib.request.Request(
        f"http://127.0.0.1:8737/t/{token()}/permission",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    # Long timeout: the user may take a while to tap a button.
    with urllib.request.urlopen(req, timeout=300) as resp:
        return json.loads(resp.read())


def reply(msg_id, result):
    sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": msg_id, "result": result}) + "\n")
    sys.stdout.flush()


APPROVE_TOOL = {
    "name": "approve",
    "description": "Ask the Notch user to approve or deny a tool call.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "tool_name": {"type": "string"},
            "input": {"type": "object"},
        },
        "required": ["tool_name", "input"],
    },
}


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        method = msg.get("method")
        msg_id = msg.get("id")
        if method == "initialize":
            reply(msg_id, {
                "protocolVersion": msg.get("params", {}).get("protocolVersion", "2024-11-05"),
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "notch-permissions", "version": "1.0.0"},
            })
        elif method == "tools/list":
            reply(msg_id, {"tools": [APPROVE_TOOL]})
        elif method == "tools/call":
            params = msg.get("params", {})
            args = params.get("arguments", {})
            tool_name = args.get("tool_name", "unknown")
            tool_input = args.get("input", {})
            try:
                decision = ask_notch(tool_name, tool_input)
            except Exception as e:  # Notch unreachable → fail closed
                decision = {"behavior": "deny", "message": f"Notch unreachable: {e}"}
            if decision.get("behavior") == "allow":
                payload = {"behavior": "allow", "updatedInput": tool_input}
            else:
                payload = {
                    "behavior": "deny",
                    "message": decision.get("message", "Denied by the user in Notch."),
                }
            reply(msg_id, {"content": [{"type": "text", "text": json.dumps(payload)}]})
        elif msg_id is not None:
            # Politely refuse anything else that expects a response.
            reply(msg_id, {})


if __name__ == "__main__":
    main()
