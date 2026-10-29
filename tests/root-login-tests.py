import os, pathlib, subprocess, unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]
class RootLogin(unittest.TestCase):
 def check_prefix(self, sudo_user):
  for name in ['bootstrap-01.sh','bootstrap-02.sh']:
   text=(ROOT/name).read_text()
   prefix=text.split('/lib/common.sh"',1)[1].split('host_check',1)[0]
   env=os.environ.copy();env['HOME']='/tmp/not-the-install-home';env.pop('SUDO_USER',None)
   if sudo_user is not None:env['SUDO_USER']=sudo_user
   r=subprocess.run(['bash','-c',prefix+'\nprintf "%s" "$HOME"'],env=env,text=True,capture_output=True)
   self.assertEqual(r.returncode,0,r.stderr);self.assertEqual(r.stdout,'/root')
 def test_direct_root(self):self.check_prefix(None)
 def test_sudo_environment_does_not_change_root_install(self):self.check_prefix('root')
 def test_nonroot_sudo_user_is_ignored(self):self.check_prefix('developer')
 def test_no_privilege_dispatch_left(self):
  for name in ['bootstrap-01.sh','bootstrap-02.sh','lib/common.sh','scripts/diagnostics.sh']:
   text=(ROOT/name).read_text();self.assertNotIn('as_root',text);self.assertNotIn('sudo ',text);self.assertNotIn('non-root SSH',text)
if __name__=='__main__':unittest.main(verbosity=2)
