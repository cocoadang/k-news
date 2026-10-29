import json,os,subprocess,time,urllib.request,urllib.error,re
P='gen-lang-client-0064554427';R='asia-south1';S='spacex-intelligence-news-monitor'
sha=os.environ['GITHUB_SHA'];revision=S+'-gh-'+sha[:12];image=R+'-docker.pkg.dev/'+P+'/knews-images/k-news:'+sha
if os.environ.get('GITHUB_REPOSITORY')!='cocoadang/k-news' or os.environ.get('GITHUB_REF')!='refs/heads/main' or os.environ.get('GITHUB_EVENT_NAME')!='push':raise SystemExit('Unapproved execution context')
def run(args,payload=None):
 r=subprocess.run(['gcloud','--project='+P,'--quiet',*args],input=payload,capture_output=True,text=True)
 if r.returncode:
  # Only the CLI ERROR line; never response bodies or runtime environment values.
  line=next((x for x in r.stderr.splitlines() if x.startswith('ERROR:')),'CLI returned no error classification')
  line=re.sub(r'(AIza[\w-]+|ya29\.[\w.-]+|Bearer\s+\S+)', '[REDACTED]',line)[:800]
  raise RuntimeError('gcloud '+args[0]+' '+args[1]+': '+line)
 return r.stdout
def service():return json.loads(run(['run','services','describe',S,'--region='+R,'--format=json']))
def request(url):
 try:
  with urllib.request.urlopen(url,timeout=30) as r:return r.status,json.load(r)
 except urllib.error.HTTPError as e:return e.code,None
before=service();oldTraffic=[t for t in before['status']['traffic'] if t.get('percent',0)>0]
if len(oldTraffic)!=1 or oldTraffic[0]['percent']!=100:raise SystemExit('Expected one stable traffic revision')
old=oldTraffic[0]['revisionName'];oldspec=before['spec']['template']['spec'];promoted=False
try:
 # Preserve the full runtime spec in memory. Stale source-overlay annotations
 # cannot accompany a standalone image; never write environment values to disk.
 candidateDoc={'apiVersion':'serving.knative.dev/v1','kind':'Service','metadata':{k:v for k,v in before.get('metadata',{}).items() if k in ['name','namespace','labels','annotations']},'spec':json.loads(json.dumps(before['spec']))}
 candidateDoc['metadata'].setdefault('name',S)
 template=candidateDoc['spec']['template'];template.setdefault('metadata',{})['name']=revision
 for key in ['run.googleapis.com/sources','run.googleapis.com/base-images']:
  template['metadata'].setdefault('annotations',{}).pop(key,None)
 candidateDoc['metadata'].setdefault('annotations',{}).pop('run.googleapis.com/build-enable-automatic-updates',None)
 assert len(template['spec']['containers'])==1 and template['spec']['containers'][0]['name']=='app-container'
 template['spec']['containers'][0]['image']=image
 candidateDoc['spec']['traffic']=[{'revisionName':old,'percent':100},{'revisionName':revision,'percent':0,'tag':'ci-preview'}]
 payload=json.dumps(candidateDoc)
 run(['run','services','replace','/dev/stdin','--region='+R,'--dry-run'],payload)
 run(['run','services','replace','/dev/stdin','--region='+R],payload)
 after=service();new=after['spec']['template']['spec']
 # Only image and image-build annotations may differ; runtime configuration stays exact.
 a=json.loads(json.dumps(oldspec));b=json.loads(json.dumps(new))
 for spec in [a,b]:
  for c in spec['containers']:c.pop('image',None)
 if a!=b:raise RuntimeError('Runtime configuration changed; old traffic retained')
 rev=json.loads(run(['run','revisions','describe',revision,'--region='+R,'--format=json']))
 if not any(c.get('type')=='Ready' and c.get('status')=='True' for c in rev['status'].get('conditions',[])):raise RuntimeError('Candidate not Ready')
 candidate=next(t['url'] for t in after['status']['traffic'] if t.get('tag')=='ci-preview' and t.get('revisionName')==revision)
 def smoke(base):
  c,d=request(base+'/api/ceo/dataset');assert c==200 and isinstance(d.get('dataset',{}).get('statements'),list)
  c,d=request(base+'/api/youtube/summaries');assert c==200 and isinstance(d.get('videos'),list) and len(d['videos'])>=4
  c,d=request(base+'/api/events');assert c==200 and isinstance(d,list) and len(d)>0
  assert request(base+'/api/admin/wallstreet/status')[0]==401
 smoke(candidate)
 promoted=True # Restore stable traffic even when the promotion response is uncertain.
 run(['run','services','update-traffic',S,'--region='+R,'--to-revisions='+revision+'=100'])
 final=service();smoke(final['status']['url'])
 assert any(t.get('revisionName')==revision and t.get('percent')==100 for t in final['status']['traffic'])
 print(json.dumps({'status':'verified','commit':sha,'revision':revision,'previousRevision':old,'trafficPercent':100,'runtimeConfigUnchanged':True}))
except Exception as e:
 if promoted:run(['run','services','update-traffic',S,'--region='+R,'--to-revisions='+old+'=100'])
 print(json.dumps({'status':'failed_old_revision_retained','errorType':type(e).__name__,'reason':str(e),'previousRevision':old}))
 raise SystemExit(1)
