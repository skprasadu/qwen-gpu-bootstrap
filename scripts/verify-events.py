import json, pathlib, sys
rows=[]
for line in pathlib.Path(sys.argv[1]).read_text().splitlines():
 try: rows.append(json.loads(line))
 except json.JSONDecodeError: pass
assert not any(r.get("type") == "error" for r in rows), "OpenCode error event"
parts=[r.get("part",{}) for r in rows if r.get("type")=="tool_use"]
completed=[p for p in parts if p.get("state",{}).get("status")=="completed"]
assert any(p.get("tool") in {"write","edit","apply_patch"} for p in completed), "No completed file-edit tool event"
if sys.argv[2] == "repair":
 commands=[p.get("state",{}).get("input",{}).get("command","") for p in parts if p.get("tool")=="bash"]
 assert sum("python3 verify.py" in c for c in commands)>=2, "Expected observed failure and verification commands"
 checks=[(i,p) for i,p in enumerate(parts) if p.get("tool")=="bash" and "python3 verify.py" in p.get("state",{}).get("input",{}).get("command","")]
 edits=[i for i,p in enumerate(parts) if p.get("tool") in {"edit","write","apply_patch"} and p.get("state",{}).get("status")=="completed"]
 assert any(checks[0][0] < i < checks[-1][0] for i in edits), "Repair must occur between test runs"
 # v1.19.5 emits bash exit status in metadata, plus captured output.
 first=checks[0][1].get("state",{}); last=checks[-1][1].get("state",{})
 assert first.get("metadata",{}).get("exit") not in (None,0), "No observed failing test exit"
 assert last.get("metadata",{}).get("exit")==0, "No successful verification exit"
print("PASS: OpenCode completed tool-event evidence")
