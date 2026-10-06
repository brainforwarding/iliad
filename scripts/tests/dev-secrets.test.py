#!/usr/bin/env python3
"""Offline safety regression tests with synthetic credentials only."""
import hashlib, importlib.machinery, importlib.util, json, os, pathlib, shutil, subprocess, tempfile, unittest
SCRIPT=pathlib.Path(__file__).resolve().parents[1]/'dev-secrets'
class Provisioning(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory(); self.root=pathlib.Path(self.temp.name)/'repo'; (self.root/'scripts').mkdir(parents=True)
  shutil.copy2(SCRIPT,self.root/'scripts/dev-secrets'); subprocess.run(['git','init','-q',str(self.root)],check=True)
  (self.root/'.gitignore').write_text('.env\n.dev-secrets.lock/\n.dev-secrets-tmp-*/\n')
  self.schema={'version':1,'default':'development','profiles':{'development':{'enabled':True,'files':[{'target':'.env','loader':'simple','variables':{'API_KEY':{'kind':'secret','reference':'op://test/item/API_KEY'},'PORT':{'kind':'config','value':'8123'}}}]}}}
  self.save(); self.bin=pathlib.Path(self.temp.name)/'bin'; self.bin.mkdir()
  (self.bin/'op').write_text('#!/usr/bin/env python3\nimport json,os,sys\nif os.getenv("FAIL_OP"): print("synthetic-private-diagnostic",file=sys.stderr);sys.exit(1)\nprint(json.dumps({"fields":[{"label":"API_KEY","value":"synthetic-private-fixture"}]}))\n'); (self.bin/'op').chmod(0o755)
  self.env=dict(os.environ,PATH=str(self.bin)+os.pathsep+os.environ['PATH'])
 def tearDown(self): self.temp.cleanup()
 def save(self): (self.root/'.dev-secrets.json').write_text(json.dumps(self.schema))
 def runscript(self,*args,extra=None): return subprocess.run([str(self.root/'scripts/dev-secrets'),*args],env={**self.env,**(extra or {})},stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 def provision(self): self.assertEqual(self.runscript('provision').returncode,0)
 def test_provision_refresh_and_offline_status(self):
  self.provision(); self.assertEqual((self.root/'.env').stat().st_mode&0o777,0o600)
  self.assertEqual(self.runscript('refresh').returncode,0)
  before=(self.root/'.env').read_bytes(); z=self.runscript('status','--json',extra={'FAIL_OP':'1'});self.assertEqual(z.returncode,0)
  self.assertEqual((self.root/'.env').read_bytes(),before); self.assertNotIn('synthetic-private-fixture',z.stdout+z.stderr)
  self.assertEqual(subprocess.run(['git','-C',str(self.root),'check-ignore','--quiet','.env']).returncode,0)
  self.assertEqual(subprocess.run(['git','-C',str(self.root),'ls-files','--error-unmatch','.env'],capture_output=True).returncode,1)
 def test_legacy_file_never_overwritten(self):
  p=self.root/'.env';p.write_text('API_KEY=legacy-fixture\nPORT=8123\n');old=p.read_bytes()
  for command in ('provision','refresh'): self.assertEqual(self.runscript(command).returncode,1);self.assertEqual(p.read_bytes(),old)
 def test_failed_resolution_preserves_file_and_suppresses_values(self):
  self.provision();p=self.root/'.env';old=p.read_bytes();z=self.runscript('refresh',extra={'FAIL_OP':'1'})
  self.assertEqual(z.returncode,1);self.assertEqual(p.read_bytes(),old);self.assertNotIn('synthetic-private-diagnostic',z.stdout+z.stderr)
  self.assertFalse((self.root/'.dev-secrets.lock').exists());self.assertFalse(list(self.root.glob('.dev-secrets-tmp-*')))
 def test_status_detects_unknown_missing_duplicate_unresolved(self):
  self.provision();p=self.root/'.env';p.write_text(p.read_text().replace("PORT='8123'",'')+'EXTRA=fixture\nAPI_KEY=op://test/item/API_KEY\n');p.chmod(0o600)
  z=self.runscript('status','--json',extra={'FAIL_OP':'1'});self.assertEqual(z.returncode,2);f=json.loads(z.stdout)['files'][0]
  self.assertEqual(f['unknown'],['EXTRA']);self.assertEqual(f['missing'],['PORT']);self.assertEqual(f['duplicates'],['API_KEY']);self.assertEqual(f['unresolved'],['API_KEY'])
  before=p.read_bytes();self.assertEqual(self.runscript('refresh').returncode,1);self.assertEqual(p.read_bytes(),before)
 def test_schema_drift_reported_and_refresh_synchronizes_config(self):
  self.provision();self.schema['profiles']['development']['files'][0]['variables']['PORT']['value']='8124';self.save()
  self.assertEqual(self.runscript('status').returncode,2);self.assertEqual(self.runscript('refresh').returncode,0);self.assertEqual(self.runscript('status').returncode,0)
 def test_unsafe_permission_symlink_and_tracked_files_rejected(self):
  self.provision();p=self.root/'.env';p.chmod(0o644);old=p.read_bytes();self.assertEqual(self.runscript('refresh').returncode,1);self.assertEqual(self.runscript('status').returncode,2);self.assertEqual(p.read_bytes(),old)
  p.unlink();other=self.root/'other';other.write_text('fixture');p.symlink_to(other);self.assertEqual(self.runscript('provision').returncode,1);self.assertEqual(self.runscript('status').returncode,2)
  p.unlink();p.write_text('fixture');subprocess.run(['git','-C',str(self.root),'add','-f','.env'],check=True);self.assertEqual(self.runscript('refresh').returncode,1)
 def test_missing_secret_and_disabled_profile_do_not_contact_op(self):
  self.schema['profiles']['development']['enabled']=False;self.save();self.assertEqual(self.runscript('provision',extra={'FAIL_OP':'1'}).returncode,1)
  self.schema['profiles']['development']['enabled']=True;self.schema['profiles']['development']['files'][0]['variables']['API_KEY']={'kind':'missing','reason':'fixture'};self.save();self.assertEqual(self.runscript('provision').returncode,1);self.assertFalse((self.root/'.env').exists())
 def test_lock_and_unsafe_schema_rejected(self):
  (self.root/'.dev-secrets.lock').mkdir();self.assertEqual(self.runscript('provision').returncode,1);(self.root/'.dev-secrets.lock').rmdir()
  self.schema['profiles']['development']['files'][0]['target']='../outside';self.save();self.assertEqual(self.runscript('provision').returncode,1)
if __name__=='__main__': unittest.main()
