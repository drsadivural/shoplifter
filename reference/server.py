#!/usr/bin/env python3
"""Local-only workflow reference. No camera inference, face matching or APNs."""
import argparse,base64,hashlib,hmac,json,mimetypes,os,secrets,sqlite3,time,uuid
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from urllib.parse import urlsplit,parse_qs
from domain import validate_transition
ROOT=Path(__file__).resolve().parents[1]
DATA=Path(os.environ.get('RETAILGUARD_DATA',str(Path(__file__).resolve().parent/'data')))
MAX_BODY=8*1024*1024

def db():
    c=sqlite3.connect(DATA/'state.sqlite',timeout=10);c.row_factory=sqlite3.Row
    c.execute('PRAGMA foreign_keys=ON');return c

def now():return time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
def uid():return str(uuid.uuid4())
def password_hash(password,salt):return hashlib.pbkdf2_hmac('sha256',password.encode(),salt.encode(),600000).hex()
def audit(c,actor,action,resource):
    c.execute('INSERT INTO audit VALUES(?,?,?,?,?,?)',(uid(),actor['org_id'],actor['id'],action,resource,now()))
def initialize():
    DATA.mkdir(parents=True,exist_ok=True,mode=0o700)
    with db() as c:
        c.executescript('''
        CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,email TEXT UNIQUE NOT NULL,salt TEXT NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS cameras(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,name TEXT NOT NULL,address TEXT NOT NULL,state TEXT NOT NULL,created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS profiles(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,kind TEXT NOT NULL,reference TEXT NOT NULL,name TEXT NOT NULL,basis TEXT NOT NULL,status TEXT NOT NULL,expires TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(org_id,kind,reference));
        CREATE TABLE IF NOT EXISTS photos(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,profile_id TEXT NOT NULL REFERENCES profiles(id),mime TEXT NOT NULL,hash TEXT NOT NULL,data BLOB NOT NULL,created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS incidents(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,camera_id TEXT REFERENCES cameras(id),type TEXT NOT NULL,status TEXT NOT NULL,version INTEGER NOT NULL,assignee TEXT,outcome TEXT,description TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,resource TEXT NOT NULL,created_at TEXT NOT NULL);
        ''')
        if c.execute('SELECT 1 FROM users LIMIT 1').fetchone():return False
        pw=secrets.token_urlsafe(20);salt=secrets.token_hex(16);org=uid();user=uid()
        c.execute('INSERT INTO users VALUES(?,?,?,?,?,?)',(user,org,'admin@local.retailguard',salt,password_hash(pw,salt),'admin'))
        print('Local administrator: admin@local.retailguard\nGenerated password (shown once): '+pw)
        print('Synthetic workflow only. State: '+str(DATA));return True

class APIError(Exception):
    def __init__(self,status,code):self.status,self.code=status,code

class Handler(BaseHTTPRequestHandler):
    server_version='RetailGuardReference/1'
    def log_message(self,*args):pass
    def send_bytes(self,status,body,mime='application/json'):
        self.send_response(status);self.send_header('Content-Type',mime);self.send_header('Content-Length',str(len(body)))
        self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Referrer-Policy','no-referrer');self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'")
        self.end_headers();self.wfile.write(body)
    def respond(self,status,obj):self.send_bytes(status,json.dumps(obj,ensure_ascii=False).encode())
    def body(self):
        try:n=int(self.headers.get('Content-Length','0'))
        except ValueError:raise APIError(400,'invalid_length')
        if not 0<n<=MAX_BODY:raise APIError(413,'body_size')
        if self.headers.get('Content-Type','').split(';')[0]!='application/json':raise APIError(415,'json_required')
        try:obj=json.loads(self.rfile.read(n))
        except (ValueError,UnicodeDecodeError):raise APIError(400,'invalid_json')
        if not isinstance(obj,dict):raise APIError(422,'object_required')
        return obj
    def actor(self,c):
        token=self.headers.get('Authorization','').removeprefix('Bearer ')
        if not token:raise APIError(401,'authentication_required')
        r=c.execute('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.hash=? AND s.expires>?',(hashlib.sha256(token.encode()).hexdigest(),time.time())).fetchone()
        if not r:raise APIError(401,'session_expired')
        return dict(r)
    def text(self,p,key,maximum=1000):
        v=p.get(key)
        if not isinstance(v,str) or not v.strip() or len(v)>maximum:raise APIError(422,'invalid_'+key)
        return v.strip()
    def do_GET(self):self.dispatch('GET')
    def do_POST(self):self.dispatch('POST')
    def do_DELETE(self):self.dispatch('DELETE')
    def dispatch(self,method):
        request_id=uid()
        try:
            parsed=urlsplit(self.path);path=parsed.path.rstrip('/');q=parse_qs(parsed.query)
            if not path.startswith('/api'):
                if method!='GET':raise APIError(405,'method_not_allowed')
                self.static(parsed.path);return
            with db() as c:
                if path=='/api/login' and method=='POST':
                    p=self.body();email=self.text(p,'email',254).lower();pw=self.text(p,'password',1000)
                    u=c.execute('SELECT * FROM users WHERE email=?',(email,)).fetchone()
                    salt=u['salt'] if u else 'invalid-user-fixed-salt'
                    calculated=password_hash(pw,salt)
                    if not u or not hmac.compare_digest(calculated,u['password']):raise APIError(401,'invalid_credentials')
                    token=secrets.token_urlsafe(32);c.execute('INSERT INTO sessions VALUES(?,?,?)',(hashlib.sha256(token.encode()).hexdigest(),u['id'],time.time()+3600))
                    audit(c,dict(u),'login',u['id']);self.respond(200,{'token':token,'expires_in':3600,'role':u['role']});return
                a=self.actor(c);org=a['org_id'];actor_id=a['id']
                if path=='/api/me' and method=='GET':self.respond(200,{k:a[k] for k in ['id','email','role','org_id']});return
                if path=='/api/logout' and method=='POST':
                    token=self.headers.get('Authorization','').removeprefix('Bearer ');c.execute('DELETE FROM sessions WHERE hash=?',(hashlib.sha256(token.encode()).hexdigest(),));audit(c,a,'logout',actor_id);self.respond(200,{'ok':True});return
                if path=='/api/audit' and method=='GET':self.respond(200,{'items':[dict(r) for r in c.execute('SELECT * FROM audit WHERE org_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100',(org,))]});return
                if path=='/api/cameras':
                    if method=='GET':self.respond(200,{'items':[dict(r) for r in c.execute('SELECT * FROM cameras WHERE org_id=? ORDER BY created_at DESC',(org,))]});return
                    if method=='POST':
                        p=self.body();identifier=uid();name=self.text(p,'name',150);address=self.text(p,'address',250)
                        c.execute('INSERT INTO cameras VALUES(?,?,?,?,?,?)',(identifier,org,name,address,'pending',now()));audit(c,a,'camera.created_pending',identifier);self.respond(201,{'id':identifier,'state':'pending','message':'Metadata stored. Real ONVIF/stream/inference integration required.'});return
                if path=='/api/profiles':
                    if method=='GET':
                        sql='SELECT p.*,(SELECT COUNT(*) FROM photos f WHERE f.profile_id=p.id AND f.org_id=p.org_id) photo_count FROM profiles p WHERE p.org_id=?';values=[org]
                        if q.get('kind'):sql+=' AND p.kind=?';values.append(q['kind'][0])
                        if q.get('q'):sql+=' AND (p.reference LIKE ? OR p.name LIKE ?)';values.extend(['%'+q['q'][0]+'%']*2)
                        self.respond(200,{'items':[dict(r) for r in c.execute(sql+' ORDER BY p.created_at DESC LIMIT 200',values)]});return
                    if method=='POST':
                        p=self.body();kind=p.get('kind')
                        if kind not in ('staff','watchlist'):raise APIError(422,'invalid_kind')
                        expiry=self.text(p,'expires',10)
                        try:time.strptime(expiry,'%Y-%m-%d')
                        except ValueError:raise APIError(422,'invalid_expiry')
                        if expiry<=now()[:10]:raise APIError(422,'expiry_must_be_future')
                        identifier=uid();c.execute('INSERT INTO profiles VALUES(?,?,?,?,?,?,?,?,?)',(identifier,org,kind,self.text(p,'reference',80),self.text(p,'name',120),self.text(p,'basis',2000),'pending_review',expiry,now()));audit(c,a,'profile.created_pending_review',identifier);self.respond(201,{'id':identifier,'status':'pending_review'});return
                parts=path.split('/')
                if len(parts)==5 and parts[2]=='profiles' and parts[4]=='photos':
                    profile_id=parts[3]
                    if not c.execute('SELECT 1 FROM profiles WHERE id=? AND org_id=?',(profile_id,org)).fetchone():raise APIError(404,'not_found')
                    if method=='GET':self.respond(200,{'items':[dict(r) for r in c.execute('SELECT id,mime,hash,created_at FROM photos WHERE org_id=? AND profile_id=?',(org,profile_id))]});return
                    if method=='POST':
                        p=self.body()
                        try:data=base64.b64decode(p.get('data_base64',''),validate=True)
                        except (ValueError,TypeError):raise APIError(422,'invalid_photo_encoding')
                        if not 10<=len(data)<=5*1024*1024:raise APIError(413,'photo_size')
                        mime='image/png' if data.startswith(b'\x89PNG\r\n\x1a\n') else 'image/jpeg' if data.startswith(b'\xff\xd8\xff') and data.endswith(b'\xff\xd9') else None
                        if not mime:raise APIError(422,'jpeg_or_png_required')
                        identifier=uid();digest=hashlib.sha256(data).hexdigest();c.execute('INSERT INTO photos VALUES(?,?,?,?,?,?,?)',(identifier,org,profile_id,mime,digest,data,now()));audit(c,a,'photo.uploaded_reference_unvalidated',identifier);self.respond(201,{'id':identifier,'hash':digest,'quality':'not_evaluated'});return
                if len(parts)==4 and parts[2]=='photos':
                    photo=c.execute('SELECT * FROM photos WHERE id=? AND org_id=?',(parts[3],org)).fetchone()
                    if not photo:raise APIError(404,'not_found')
                    if method=='GET':self.send_bytes(200,photo['data'],photo['mime']);return
                    if method=='DELETE':c.execute('DELETE FROM photos WHERE id=? AND org_id=?',(parts[3],org));audit(c,a,'photo.deleted',parts[3]);self.respond(200,{'ok':True});return
                if path=='/api/incidents':
                    if method=='GET':
                        sql='SELECT * FROM incidents WHERE org_id=?';values=[org]
                        for name in ['type','outcome','status']:
                            if q.get(name):sql+=' AND '+name+'=?';values.append(q[name][0])
                        if q.get('q'):sql+=' AND (description LIKE ? OR reason LIKE ? OR id LIKE ?)';values.extend(['%'+q['q'][0]+'%']*3)
                        self.respond(200,{'items':[dict(r) for r in c.execute(sql+' ORDER BY created_at DESC,rowid DESC LIMIT 200',values)]});return
                    if method=='POST':
                        p=self.body();typ=p.get('type');camera_id=p.get('camera_id') or None
                        if typ not in ('manual_observation','behavior_candidate','watchlist_candidate','checkout_exception','rfid_exception'):raise APIError(422,'invalid_type')
                        if camera_id and not c.execute('SELECT 1 FROM cameras WHERE id=? AND org_id=?',(camera_id,org)).fetchone():raise APIError(404,'camera_not_found')
                        # Reference accepts manual records only; inference channel names require real production ingress.
                        if typ!='manual_observation':raise APIError(422,'reference_accepts_manual_observation_only')
                        identifier=uid();stamp=now();c.execute('INSERT INTO incidents VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',(identifier,org,camera_id,typ,'new',1,None,None,self.text(p,'description',2000),'',stamp,stamp));audit(c,a,'incident.manual_created',identifier);self.respond(201,{'id':identifier,'version':1});return
                if len(parts)>=4 and parts[2]=='incidents':
                    r=c.execute('SELECT * FROM incidents WHERE id=? AND org_id=?',(parts[3],org)).fetchone()
                    if not r:raise APIError(404,'not_found')
                    if len(parts)==4 and method=='GET':self.respond(200,dict(r));return
                    if len(parts)==5 and parts[4]=='transition' and method=='POST':
                        p=self.body()
                        try:status=validate_transition(dict(r),p.get('action'),p.get('expected_version'),actor_id,p.get('reason'),p.get('outcome'))
                        except ValueError as exc:raise APIError(409 if str(exc) in ('version_conflict','owned_by_another_responder','invalid_transition') else 422,str(exc))
                        cur=c.execute('UPDATE incidents SET status=?,version=version+1,assignee=?,outcome=?,reason=?,updated_at=? WHERE id=? AND org_id=? AND version=?',(status,actor_id,p.get('outcome') if status=='resolved' else None,p['reason'],now(),r['id'],org,r['version']))
                        if cur.rowcount!=1:raise APIError(409,'version_conflict')
                        audit(c,a,'incident.'+p['action'],r['id']);self.respond(200,dict(c.execute('SELECT * FROM incidents WHERE id=? AND org_id=?',(r['id'],org)).fetchone()));return
                raise APIError(404,'not_found')
        except APIError as exc:self.respond(exc.status,{'code':exc.code,'request_id':request_id})
        except sqlite3.IntegrityError:self.respond(409,{'code':'constraint_conflict','request_id':request_id})
        except (BrokenPipeError,ConnectionResetError):pass
        except Exception:self.respond(500,{'code':'internal_error','request_id':request_id})
    def static(self,path):
        if path=='/':path='/workbench/'
        if path=='/workbench/' or path=='/workbench':target=ROOT/'reference/workbench.html'
        elif path=='/workbench.js':target=ROOT/'reference/workbench.js'
        elif path.startswith(('/design/','/assets/','/mockups/')):
            allowed_root=ROOT/path.split('/')[1]
            target=(ROOT/path.lstrip('/')).resolve()
            if not target.is_relative_to(allowed_root) or any(p.startswith('.') for p in target.relative_to(ROOT).parts):raise APIError(404,'not_found')
            if target.is_dir():target=target/'index.html'
        else:raise APIError(404,'not_found')
        if not target.is_file():raise APIError(404,'not_found')
        self.send_bytes(200,target.read_bytes(),mimetypes.guess_type(str(target))[0] or 'application/octet-stream')

def main():
    ap=argparse.ArgumentParser();ap.add_argument('command',choices=['init','serve']);args=ap.parse_args()
    if args.command=='init':initialize();return
    if not(DATA/'state.sqlite').is_file():raise SystemExit('Run python3 reference/server.py init first.')
    port=int(os.environ.get('RETAILGUARD_PORT','8788'))
    server=ThreadingHTTPServer(('127.0.0.1',port),Handler)
    print(f'Local reference: http://127.0.0.1:{port}/workbench/ (no real ML)',flush=True)
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.server_close()
if __name__=='__main__':main()
