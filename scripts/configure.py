import json, pathlib, sys
state = pathlib.Path(sys.argv[1]).resolve()
config = {
 "$schema": "https://opencode.ai/config.json",
 "model": "local/qwen3-coder-next", "small_model": "local/qwen3-coder-next",
 "enabled_providers": ["local"], "autoupdate": False,
 "provider": {"local": {"npm": "@ai-sdk/openai-compatible", "name": "Local Qwen",
  "options": {"baseURL": "http://127.0.0.1:8000/v1", "apiKey": "{file:"+str(state / "api-key")+"}"},
  "models": {"qwen3-coder-next": {"name": "Qwen3-Coder-Next FP8", "tool_call": True,
   "limit": {"context": 16384, "output": 2048}}}}},
 "permission": {"*": "ask", "read": "allow", "list": "allow", "glob": "allow", "grep": "allow"}
}
# Dedicated config avoids overwriting or merging into existing user configuration.
(state / "opencode.json").write_text(json.dumps(config, indent=2)+"\n")
(state / "opencode.json").chmod(0o600)
