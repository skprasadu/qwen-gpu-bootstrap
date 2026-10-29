import pathlib, subprocess, sys, tempfile, unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]
class Upgrade(unittest.TestCase):
 def test_enable_preserves_app_and_is_idempotent(self):
  with tempfile.TemporaryDirectory() as t:
   app=pathlib.Path(t);(app/'AGENTS.md').write_text('My existing rules.\n');(app/'code.rs').write_text('unchanged')
   for _ in range(2):subprocess.run([sys.executable,str(ROOT/'scripts/enable-rust-loop.py'),str(app),str(ROOT)],check=True,capture_output=True)
   self.assertTrue((app/'AGENTS.md').read_text().startswith('My existing rules.\n'))
   self.assertEqual((app/'AGENTS.md').read_text().count('<!-- rust-loop-v2 -->'),1)
   backups=list(app.glob('AGENTS.md.before-*'));self.assertEqual(len(backups),1);self.assertEqual(backups[0].read_text(),'My existing rules.\n');self.assertEqual((app/'code.rs').read_text(),'unchanged');self.assertEqual((app/'.gitignore').read_text().count('.rust-loop/'),1)
if __name__=='__main__':unittest.main(verbosity=2)
