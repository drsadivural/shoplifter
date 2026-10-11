import hashlib,uuid,sqlite3,concurrent.futures,base64,contextlib,importlib.util,json,os,socket,subprocess,sys,tempfile,time,unittest,urllib.request,urllib.error
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
class APIWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory();s=socket.socket();s.bind(('127.0.0.1',0));port=s.getsockname()[1];s.close()
        env={**os.environ,'RETAILGUARD_DATA':cls.tmp.name,'RETAILGUARD_PORT':str(port)}
        output=subprocess.check_output([sys.executable,str(ROOT/'reference/server.py'),'init'],env=env,text=True)
        pw=output.split('Generated password (shown once): ')[1].splitlines()[0]
        cls.process=subprocess.Popen([sys.executable,str(ROOT/'reference/server.py'),'serve'],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        cls.base=f'http://127.0.0.1:{port}';cls.token=''
        for _ in range(100):
            try:
                urllib.request.urlopen(cls.base+'/workbench/',timeout=.5).close();break
            except (urllib.error.URLError,ConnectionError):time.sleep(.02)
        status,r=cls.call('/api/login','POST',{'email':'admin@local.retailguard','password':pw});assert status==200,r;cls.token=r['token']
    @classmethod
    def tearDownClass(cls):cls.process.terminate();cls.process.wait(timeout=5);cls.process.stderr.close();cls.tmp.cleanup()
    @classmethod
    def call(cls,path,method='GET',data=None,auth=True):
        headers={'Content-Type':'application/json'}
        if auth and cls.token:headers['Authorization']='Bearer '+cls.token
        req=urllib.request.Request(cls.base+path,method=method,headers=headers,data=json.dumps(data).encode() if data is not None else None)
        try:
            with urllib.request.urlopen(req,timeout=10) as response:return response.status,json.loads(response.read())
        except urllib.error.HTTPError as e:return e.code,json.loads(e.read())
    def test_concurrent_claim_has_one_winner(self):
        _,incident=self.call('/api/incidents','POST',{'type':'manual_observation','description':'Concurrent claim test'})
        def claim():return self.call('/api/incidents/'+incident['id']+'/transition','POST',{'action':'acknowledge','expected_version':1,'reason':'Concurrent reviewer'})[0]
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(lambda _:claim(),range(2)))
        self.assertEqual(sorted(results),[200,409])
    def test_cross_tenant_record_denied(self):
        _,incident=self.call('/api/incidents','POST',{'type':'manual_observation','description':'Private tenant facts'})
        other=str(uuid.uuid4());salt='test-tenant-salt';pw='SyntheticTestPasswordForOtherTenant';email=other+'@local.test'
        with sqlite3.connect(Path(self.tmp.name)/'state.sqlite') as c:
            c.execute('INSERT INTO users VALUES(?,?,?,?,?,?)',(str(uuid.uuid4()),other,email,salt,hashlib.pbkdf2_hmac('sha256',pw.encode(),salt.encode(),600000).hex(),'admin'))
        _,session=self.call('/api/login','POST',{'email':email,'password':pw},auth=False)
        old=self.token
        try:
            type(self).token=session['token']
            self.assertEqual(self.call('/api/incidents/'+incident['id'])[0],404)
            self.assertFalse(any(x['id']==incident['id'] for x in self.call('/api/incidents')[1]['items']))
        finally:type(self).token=old
    def test_anonymous_cannot_read(self):self.assertEqual(self.call('/api/incidents',auth=False)[0],401)
    def test_bad_credentials_denied(self):self.assertEqual(self.call('/api/login','POST',{'email':'admin@local.retailguard','password':'wrong'},auth=False)[0],401)
    def test_complete_manual_workflow(self):
        status,c=self.call('/api/cameras','POST',{'name':'Test camera','address':'192.168.10.21'});self.assertEqual(status,201);self.assertEqual(c['state'],'pending')
        status,p=self.call('/api/profiles','POST',{'kind':'staff','reference':'STF-TEST','name':'Synthetic staff','basis':'Synthetic photo notice','expires':'2030-01-01'});self.assertEqual(status,201)
        # Minimal magic-valid payload checks reference limitation, not production image quality.
        status,photo=self.call('/api/profiles/'+p['id']+'/photos','POST',{'filename':'synthetic.png','data_base64':base64.b64encode(b'\x89PNG\r\n\x1a\n'+b'0'*30).decode()});self.assertEqual(status,201);self.assertEqual(photo['quality'],'not_evaluated')
        status,i=self.call('/api/incidents','POST',{'type':'manual_observation','camera_id':c['id'],'description':'Test manual observed facts'});self.assertEqual(status,201)
        status,r=self.call('/api/incidents/'+i['id']+'/transition','POST',{'action':'acknowledge','expected_version':1,'reason':'Operator viewed record'});self.assertEqual(status,200);self.assertEqual(r['version'],2)
        status,_=self.call('/api/incidents/'+i['id']+'/transition','POST',{'action':'acknowledge','expected_version':1,'reason':'Stale claim'});self.assertEqual(status,409)
        status,r=self.call('/api/incidents/'+i['id']+'/transition','POST',{'action':'resolve','expected_version':2,'reason':'Insufficient evidence','outcome':'inconclusive'});self.assertEqual(status,200);self.assertEqual(r['outcome'],'inconclusive')
        status,found=self.call('/api/incidents?q=manual%20observed');self.assertTrue(any(x['id']==i['id'] for x in found['items']))
        status,a=self.call('/api/audit');self.assertTrue(any(x['action']=='incident.resolve' for x in a['items']))
    def test_invalid_photo_rejected(self):
        _,p=self.call('/api/profiles','POST',{'kind':'watchlist','reference':'WL-TEST','name':'Synthetic reference','basis':'Design testing only','expires':'2030-01-01'})
        status,_=self.call('/api/profiles/'+p['id']+'/photos','POST',{'data_base64':base64.b64encode(b'not an image').decode()});self.assertEqual(status,422)
    def test_missing_camera_denied(self):self.assertEqual(self.call('/api/incidents','POST',{'type':'manual_observation','camera_id':'missing','description':'Test'})[0],404)
    def test_no_fake_inference_ingress(self):self.assertEqual(self.call('/api/incidents','POST',{'type':'behavior_candidate','description':'Fake ML claim'})[0],422)
    def test_expiry_required_future(self):self.assertEqual(self.call('/api/profiles','POST',{'kind':'staff','reference':'OLD','name':'Test','basis':'Test','expires':'2000-01-01'})[0],422)
    def test_static_path_traversal_denied(self):self.assertEqual(self.call('/design/../reference/data/state.sqlite')[0],404)
    def test_private_database_not_served(self):self.assertEqual(self.call('/reference/data/state.sqlite')[0],404)
if __name__=='__main__':unittest.main()
