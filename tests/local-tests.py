#!/usr/bin/env python3
"""CPU checks only: shell syntax, config creation, guards, evidence validation."""
import json, os, pathlib, subprocess, sys, tempfile, unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]
class Local(unittest.TestCase):
 def test_shell_syntax(self):
  for f in ROOT.rglob('*.sh'):
   subprocess.run(['bash','-n',str(f)],check=True)
 def test_config_idempotent_private(self):
  with tempfile.TemporaryDirectory() as t:
   p=pathlib.Path(t)
   for _ in range(2):
    subprocess.run([sys.executable,str(ROOT/'scripts/configure.py'),t],check=True)
   c=json.loads((p/'opencode.json').read_text())
   self.assertEqual(c['model'],'local/qwen3-coder-next')
   self.assertTrue(c['provider']['local']['models']['qwen3-coder-next']['tool_call'])
   self.assertEqual(c['enabled_providers'],['local'])
   self.assertEqual((p/'opencode.json').stat().st_mode & 0o777,0o600)
   self.assertNotIn('allow',c['permission'].get('bash',''))
 def test_new_app_refuses_existing(self):
  with tempfile.TemporaryDirectory() as t:
   r=subprocess.run(['bash',str(ROOT/'scripts/new-app.sh'),t],capture_output=True,text=True)
   self.assertNotEqual(r.returncode,0)
   self.assertIn('already exists',r.stdout)
 def test_tool_evidence_rejects_prose_and_accepts_completed_edit(self):
  with tempfile.TemporaryDirectory() as t:
   p=pathlib.Path(t)/'events'
   for rows,want in [([{'type':'text','part':{'text':'Done'}}],False),
    ([{'type':'tool_use','part':{'tool':'write','state':{'status':'completed'}}}],True),
    ([{'type':'tool_use','part':{'tool':'write','state':{'status':'error'}}}],False)]:
    p.write_text('\n'.join(json.dumps(r) for r in rows))
    r=subprocess.run([sys.executable,str(ROOT/'scripts/verify-events.py'),str(p),'edit'],capture_output=True)
    self.assertEqual(r.returncode==0,want)
 def test_host_preflight_before_mutation(self):
  if sys.platform != 'darwin': self.skipTest('checks unsupported macOS host rejection')
  r=subprocess.run(['bash',str(ROOT/'bootstrap-01.sh')],capture_output=True,text=True)
  self.assertNotEqual(r.returncode,0)
  self.assertIn('Requires',r.stderr)
if __name__=='__main__': unittest.main(verbosity=2)
