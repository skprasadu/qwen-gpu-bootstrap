#!/usr/bin/env python3
"""Run the REAL pinned OpenCode client against a SCRIPTED, NON-LLM API.
This validates client/tool/event plumbing, never Qwen or GPU behavior.
Usage: python3 tests/mock-client.py /absolute/path/to/opencode
"""
import http.server, json, os, pathlib, subprocess, sys, tempfile, threading, time
ROOT=pathlib.Path(__file__).resolve().parents[1]
client=str(pathlib.Path(sys.argv[1]).resolve())
with tempfile.TemporaryDirectory(prefix='opencode-mock-') as td:
 d=pathlib.Path(td).resolve(); state=d/'state'; state.mkdir(); (state/'api-key').write_text('mock-only')
 subprocess.run([sys.executable,str(ROOT/'scripts/configure.py'),str(state)],check=True)
 phase={'name':'edit','step':0}; requests=[]
 class Handler(http.server.BaseHTTPRequestHandler):
  def log_message(self,*args): pass
  def do_POST(self):
   req=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
   requests.append(req)
   n=phase['step'] if req.get('tools') else -1
   if req.get('tools'): phase['step']+=1
   call=None
   if phase['name']=='edit' and n==0:
    call=('write',{'filePath':str(d/'hello.txt'),'content':'TOOL_EDIT_OK\n'})
   if phase['name']=='repair':
    seq=[('bash',{'command':'python3 verify.py','description':'Observe broken test'}),
     ('read',{'filePath':str(d/'calc.py')}),
     ('edit',{'filePath':str(d/'calc.py'),'oldString':'return a - b','newString':'return a + b'}),
     ('bash',{'command':'python3 verify.py','description':'Verify repaired test'})]
    if 0<=n<len(seq): call=seq[n]
   if call:
    available=[t['function']['name'] for t in req.get('tools',[])]
    if call[0] not in available: raise RuntimeError(('Tool unavailable',call[0],available))
    delta={'role':'assistant','tool_calls':[{'index':0,'id':f'call_{n}','type':'function','function':{'name':call[0],'arguments':json.dumps(call[1])}}]}
   else: delta={'role':'assistant','content':'Completed scripted mock test.'}
   finish='tool_calls' if call else 'stop'
   base={'id':f'chatcmpl-{phase["name"]}-{n}','object':'chat.completion.chunk','created':int(time.time()),'model':'qwen3-coder-next'}
   chunks=[dict(base,choices=[{'index':0,'delta':delta,'finish_reason':None}]),dict(base,choices=[{'index':0,'delta':{},'finish_reason':finish}],usage={'prompt_tokens':200,'completion_tokens':30,'total_tokens':230})]
   payload=''.join('data: '+json.dumps(c)+'\n\n' for c in chunks)+'data: [DONE]\n\n'
   self.send_response(200); self.send_header('Content-Type','text/event-stream'); self.send_header('Content-Length',str(len(payload.encode()))); self.end_headers(); self.wfile.write(payload.encode())
 server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
 threading.Thread(target=server.serve_forever,daemon=True).start()
 cfg=json.loads((state/'opencode.json').read_text()); cfg['provider']['local']['options']['baseURL']=f'http://127.0.0.1:{server.server_port}/v1'
 (state/'opencode.json').write_text(json.dumps(cfg))
 env=os.environ.copy(); env.update(PYTHONDONTWRITEBYTECODE='1',OPENCODE_CONFIG=str(state/'opencode.json'),OPENCODE_PERMISSION=json.dumps({'*':'allow','external_directory':{'*':'deny',str(d/'*'):'allow'}}))
 for name in ['CONFIG','DATA','CACHE','STATE']: env['XDG_'+name+'_HOME']=str(d/('xdg-'+name.lower()))
 for mode in ['edit','repair']:
  phase.update(name=mode,step=0)
  if mode=='repair':
   (d/'calc.py').write_text('def add(a, b):\n    return a - b\n')
   (d/'verify.py').write_text('from calc import add\nassert add(2, 3) == 5\nassert add(-1, 1) == 0\nprint("repair verified")\n')
  result=subprocess.run([client,'run','--dir',str(d),'--agent','build','--format','json','-m','local/qwen3-coder-next',f'Perform the {mode} test with the tools.'],cwd=d,env=env,capture_output=True,text=True,timeout=120)
  events=d/(mode+'.jsonl'); events.write_text(result.stdout)
  if result.returncode: print(result.stdout,result.stderr); raise SystemExit(result.returncode)
  checked=subprocess.run([sys.executable,str(ROOT/'scripts/verify-events.py'),str(events),mode],capture_output=True,text=True)
  if checked.returncode: print(result.stdout,result.stderr,checked.stderr); raise SystemExit(1)
  print(checked.stdout.strip())
 assert (d/'hello.txt').read_text()=='TOOL_EDIT_OK\n'
 subprocess.run([sys.executable,'verify.py'],cwd=d,check=True)
 assert len(requests)>=7
 print('Tool request sizes (bytes):', [len(json.dumps(r)) for r in requests if r.get('tools')])
 assert all(r['model']=='qwen3-coder-next' for r in requests)
 server.shutdown()
 print('PASS: REAL OpenCode client, SCRIPTED API, actual local write/repair tools. No model or GPU tested.')
