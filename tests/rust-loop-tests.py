#!/usr/bin/env python3
"""Real Cargo/rustfmt/Clippy/tests; scripted OpenCode replacement, NO LLM/GPU."""
import os, pathlib, subprocess, sys, tempfile, unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]
BIN=pathlib.Path(os.environ.get('RUST_LOOP_BIN', ROOT/'tools/rust-loop/target/debug/rust-loop')).resolve()
GOOD='pub fn add(a: i32, b: i32) -> i32 {\n    a + b\n}\n'
BAD_COMPILE='pub fn add(a: i32, b: i32) -> i32 {\n    a + missing\n}\n'
BAD_BEHAVIOR='pub fn add(a: i32, b: i32) -> i32 {\n    a - b\n}\n'
FAKE='''#!/usr/bin/env python3
import pathlib,os,sys,time
p=pathlib.Path(sys.argv[sys.argv.index('--dir')+1])
mode=os.environ['SCRIPTED_REPAIR_MODE']
if mode=='timeout': time.sleep(10)
elif mode=='noop': pass
elif mode=='tamper': (p/'tests/behavior.rs').write_text('')
elif mode=='newfile': (p/'src/extra.rs').write_text('pub fn shortcut() {}')
elif mode=='manifest': (p/'Cargo.toml').write_text('[package]\\nname="fake"\\nversion="0.1.0"\\n')
elif mode=='concurrent':
 pathlib.Path(os.environ['ORIGINAL_FILE']).write_text('concurrent user edit\\n')
 (p/'src/lib.rs').write_text((p/'src/lib.rs').read_text().replace('a + missing','a + b'))
elif mode=='partial':
 f=p/'src/lib.rs'; text=f.read_text()
 if 'a - b' in text: text=text.replace('a - b','a + b + 1')
 elif 'a + b + 1' in text: text=text.replace('a + b + 1','a + b + 2')
 f.write_text(text)
else:
 f=p/'src/lib.rs'
 text=f.read_text().replace('a + missing','a + b').replace('a - b','a + b').replace('return a + b;', 'a + b')
 f.write_text(text)
print('SCRIPTED CPU FIXTURE, not model output')
'''
class Loop(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
  self.base=pathlib.Path(self.tmp.name).resolve();self.app=self.base/'backend'
  (self.app/'src').mkdir(parents=True);(self.app/'tests').mkdir()
  (self.app/'Cargo.toml').write_text('[package]\nname="fixture"\nversion="0.1.0"\nedition="2021"\n')
  (self.app/'tests/behavior.rs').write_text('#[test]\nfn adds() {\n    assert_eq!(fixture::add(2, 3), 5);\n    assert_eq!(fixture::add(-1, 1), 0);\n}\n')
  (self.app/'src/lib.rs').write_text(GOOD)
  (self.app/'Cargo.lock').write_text('version = 4\n\n[[package]]\nname = "fixture"\nversion = "0.1.0"\n')
  tools=self.base/'bin';tools.mkdir();stub=tools/'opencode';stub.write_text(FAKE);stub.chmod(0o755)
  home=self.base/'home';config=home/'.local/share/qwen-bootstrap';config.mkdir(parents=True)
  (config/'opencode.json').write_text('{}')
  self.env=os.environ.copy();self.env.update(HOME=str(home), CARGO_HOME=os.environ.get('CARGO_HOME',str(pathlib.Path.home()/'.cargo')),RUSTUP_HOME=os.environ.get('RUSTUP_HOME',str(pathlib.Path.home()/'.rustup')),PATH=str(tools)+os.pathsep+os.environ['PATH'],SCRIPTED_REPAIR_MODE='fix',ORIGINAL_FILE=str(self.app/'src/lib.rs'))
  # Rust runner deliberately sets no fixed target dir: each candidate is isolated.
  self.env.pop('CARGO_TARGET_DIR',None)
 def run_loop(self,mode='repair',expect=True,timeout=30):
  r=subprocess.run([str(BIN),mode,'--project',str(self.app),'--max-attempts','2','--timeout-secs',str(timeout)],env=self.env,capture_output=True,text=True,timeout=120)
  self.assertEqual(r.returncode==0,expect,r.stdout+r.stderr)
  self.output=r.stdout+r.stderr
  return r
 def test_check_clean(self):self.run_loop('check')
 def test_check_failing_preserves_original(self):
  f=self.app/'src/lib.rs';f.write_text(BAD_COMPILE);self.run_loop('check',False);self.assertEqual(f.read_text(),BAD_COMPILE)
 def test_compiler_repair_passes_all_gates(self):
  f=self.app/'src/lib.rs';f.write_text(BAD_COMPILE);self.run_loop();self.assertEqual(f.read_text(),GOOD);self.assertIn('all five gates',self.output)
 def test_behavior_repair_requires_tests(self):
  f=self.app/'src/lib.rs';f.write_text(BAD_BEHAVIOR);self.run_loop();self.assertEqual(f.read_text(),GOOD);self.assertIn('FAIL tests',self.output)
 def test_format_repair_without_model(self):
  (self.app/'src/lib.rs').write_text('pub fn add(a:i32,b:i32)->i32{a+b}\n');self.env['SCRIPTED_REPAIR_MODE']='timeout';self.run_loop();self.assertEqual((self.app/'src/lib.rs').read_text(),GOOD)
 def test_test_tampering_rejected(self):
  f=self.app/'src/lib.rs';f.write_text(BAD_BEHAVIOR);old=(self.app/'tests/behavior.rs').read_bytes();self.env['SCRIPTED_REPAIR_MODE']='tamper';self.run_loop(expect=False);self.assertEqual(f.read_text(),BAD_BEHAVIOR);self.assertEqual((self.app/'tests/behavior.rs').read_bytes(),old);self.assertIn('Protected file changed',self.output)
 def test_no_progress_bounded(self):
  f=self.app/'src/lib.rs';f.write_text(BAD_COMPILE);self.env['SCRIPTED_REPAIR_MODE']='noop';self.run_loop(expect=False);self.assertEqual(f.read_text(),BAD_COMPILE);self.assertIn('No source progress',self.output)
 def test_new_source_file_rejected(self):
  (self.app/'src/lib.rs').write_text(BAD_COMPILE);self.env['SCRIPTED_REPAIR_MODE']='newfile';self.run_loop(expect=False);self.assertFalse((self.app/'src/extra.rs').exists());self.assertIn('New file forbidden',self.output)
 def test_concurrent_edit_preserved(self):
  (self.app/'src/lib.rs').write_text(BAD_COMPILE);self.env['SCRIPTED_REPAIR_MODE']='concurrent';self.run_loop(expect=False);self.assertEqual((self.app/'src/lib.rs').read_text(),'concurrent user edit\n');self.assertIn('Project changed during repair',self.output)
 def test_symlink_rejected(self):
  (self.app/'src/link.rs').symlink_to(self.app/'src/lib.rs');self.run_loop(expect=False);self.assertIn('Symlink unsupported',self.output)
 def test_inline_test_file_frozen(self):
  f=self.app/'src/lib.rs';f.write_text(BAD_COMPILE+'\n#[cfg(test)]\nmod tests {}\n');self.run_loop(expect=False);self.assertIn('inline tests',self.output);self.assertIn('missing',f.read_text())
 def test_no_tests_is_not_a_pass(self):
  (self.app/'tests/behavior.rs').unlink();self.run_loop('check',False);self.assertIn('FAIL tests',self.output)
 def test_clippy_warning_repaired(self):
  (self.app/'src/lib.rs').write_text(GOOD.replace('a + b','return a + b;'));self.run_loop();self.assertIn('FAIL clippy',self.output)
 def test_model_timeout_preserves_source(self):
  (self.app/'src/lib.rs').write_text(BAD_COMPILE);self.env['SCRIPTED_REPAIR_MODE']='timeout';self.run_loop(expect=False,timeout=2);self.assertEqual((self.app/'src/lib.rs').read_text(),BAD_COMPILE);self.assertIn('timed out',self.output)
 def test_attempt_budget_preserves_original(self):
  f=self.app/'src/lib.rs';f.write_text(BAD_BEHAVIOR);self.env['SCRIPTED_REPAIR_MODE']='partial';self.run_loop(expect=False);self.assertEqual(f.read_text(),BAD_BEHAVIOR);self.assertIn('attempt limit reached',self.output)
 def test_manifest_change_rejected(self):
  f=self.app/'src/lib.rs';f.write_text(BAD_COMPILE);self.env['SCRIPTED_REPAIR_MODE']='manifest';self.run_loop(expect=False);self.assertEqual(f.read_text(),BAD_COMPILE);self.assertIn('Protected file changed',self.output)
if __name__=='__main__':unittest.main(verbosity=2)
