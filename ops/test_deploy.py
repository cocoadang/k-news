import unittest,runpy,os,json,copy,io,contextlib
from unittest.mock import patch
from types import SimpleNamespace
class DeploymentTests(unittest.TestCase):
 def simulate(self,mode):
  sha='a'*40;new='spacex-intelligence-news-monitor-gh-'+sha[:12];old='stable-old';calls=[];deployed=False;promoted=False
  spec={'serviceAccountName':'runtime','containers':[{'name':'app-container','image':'old','env':[{'name':'SECRET','valueFrom':{'secretKeyRef':{'name':'existing','key':'1'}}}]}]}
  def command(a,**kwargs):
   nonlocal deployed,promoted
   a=[x for x in a if not x.startswith('--project=') and x!='--quiet']
   if '--container=app-container' in a:
    self.assertTrue(all(x.startswith('--image=') for x in a[a.index('--container=app-container')+1:]))
   calls.append(a)
   if a[1:4]==['run','services','describe']:
    s=copy.deepcopy(spec)
    if deployed:s['containers'][0]['image']='new'
    if mode=='config' and deployed:s['serviceAccountName']='changed'
    d={'spec':{'template':{'spec':s}},'status':{'url':'https://live','traffic':[{'revisionName':new if promoted else old,'percent':100}]+([{'revisionName':new,'tag':'ci-preview','url':'https://candidate'}] if deployed else [])}}
   elif a[1:4]==['run','services','replace']:
    payload=json.loads(kwargs['input'])
    self.assertEqual(payload['spec']['template']['spec']['containers'][0]['env'],spec['containers'][0]['env'])
    self.assertEqual(payload['spec']['traffic'][0],{'revisionName':old,'percent':100})
    if '--dry-run' not in a:deployed=True
    d={}
   elif a[1:4]==['run','revisions','describe']:d={'status':{'conditions':[{'type':'Ready','status':'False' if mode=='ready' else 'True'}]}}
   elif a[1:4]==['run','services','update-traffic']:promoted=any(x=='--to-revisions='+new+'=100' for x in a);d={}
   else:raise AssertionError(a)
   return SimpleNamespace(returncode=0,stdout=json.dumps(d))
  class Response(io.BytesIO):
   status=200
   def __enter__(self):return self
   def __exit__(self,*a):pass
  def request(url,**kwargs):
   from urllib.error import HTTPError
   if url.endswith('/api/admin/wallstreet/status'):raise HTTPError(url,401,'',{},None)
   if mode=='smoke' and url.startswith('https://candidate'):raise HTTPError(url,500,'',{},None)
   if mode=='rollback' and url.startswith('https://live'):raise HTTPError(url,500,'',{},None)
   d={'dataset':{'statements':[]}} if url.endswith('/dataset') else {'videos':[{}, {}, {}, {}]} if url.endswith('/summaries') else [{}]
   return Response(json.dumps(d).encode())
  env={'GITHUB_SHA':sha,'GITHUB_REPOSITORY':'cocoadang/k-news','GITHUB_REF':'refs/heads/main','GITHUB_EVENT_NAME':'push'}
  if mode=='fork':env['GITHUB_REPOSITORY']='other/fork'
  with patch.dict(os.environ,env),patch('subprocess.run',command),patch('urllib.request.urlopen',request),contextlib.redirect_stdout(io.StringIO()):
   try:runpy.run_path('ops/deploy.py',run_name='__main__')
   except SystemExit:pass
  return calls,promoted
 def test_success(self):self.assertTrue(self.simulate('ok')[1])
 def test_config_mismatch_never_promotes(self):self.assertFalse(self.simulate('config')[1])
 def test_unready_never_promotes(self):self.assertFalse(self.simulate('ready')[1])
 def test_failed_smoke_never_promotes(self):self.assertFalse(self.simulate('smoke')[1])
 def test_live_failure_rolls_back(self):self.assertFalse(self.simulate('rollback')[1])
 def test_fork_has_no_cloud_calls(self):self.assertEqual(self.simulate('fork')[0],[])
if __name__=='__main__':unittest.main()
