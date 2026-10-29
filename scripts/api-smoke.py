import json, pathlib, sys, urllib.request, urllib.error
state = pathlib.Path(sys.argv[1])
key = (state / "api-key").read_text().strip()
def call(path, body=None):
 req = urllib.request.Request("http://127.0.0.1:8000"+path,
  data=json.dumps(body).encode() if body else None,
  headers={"Authorization": "Bearer "+key, "Content-Type": "application/json"})
 with urllib.request.urlopen(req, timeout=180) as r: return json.load(r)
try:
 urllib.request.urlopen("http://127.0.0.1:8000/v1/models", timeout=10)
except urllib.error.HTTPError as e:
 assert e.code == 401, f"Expected 401 without key, got {e.code}"
else:
 raise AssertionError("Server accepted model request without authentication")
assert any(m["id"] == "qwen3-coder-next" for m in call("/v1/models")["data"])
tool={"type":"function","function":{"name":"echo_probe","description":"Echo a probe value", "parameters":{"type":"object","properties":{"value":{"type":"string"}},"required":["value"]}}}
body={"model":"qwen3-coder-next","temperature":0,"max_tokens":256,
 "messages":[{"role":"user","content":"Call echo_probe exactly once with value bootstrap-ok. Do not answer in prose."}],"tools":[tool],"tool_choice":"auto"}
r=call("/v1/chat/completions",body)
msg=r["choices"][0]["message"]
tc=msg["tool_calls"][0]
assert tc["function"]["name"] == "echo_probe"
assert json.loads(tc["function"]["arguments"]) == {"value":"bootstrap-ok"}
body["messages"] += [msg, {"role":"tool","tool_call_id":tc["id"],"content":"bootstrap-ok"}, {"role":"user","content":"Now reply with bootstrap-ok only; do not call more tools."}]
body.pop("tools"); body.pop("tool_choice")
r2=call("/v1/chat/completions",body)
assert "bootstrap-ok" in r2["choices"][0]["message"]["content"]
(state/"logs"/"api-smoke.json").write_text(json.dumps({"tool":r,"followup":r2},indent=2))
print("PASS: automatic API tool call, argument JSON, and tool-result round trip")
