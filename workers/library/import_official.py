"""Build a versioned official-hardware index; never edit the source databases."""
import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path
import sqlite3
import tempfile
import os


SCHEMA = 'dreamatic-official-hardware-v1'


def digest(data):
    return hashlib.sha256(data if isinstance(data, bytes) else data.encode()).hexdigest()


def read_db(path):
    db=sqlite3.connect(path.resolve().as_uri()+'?mode=ro',uri=True)
    db.row_factory=sqlite3.Row
    db.execute('PRAGMA query_only=ON')
    return db


def confined(root,path):
    p=Path(path)
    p=(root/p).resolve() if not p.is_absolute() else p.resolve()
    if not p.is_relative_to(root.resolve()):raise ValueError('Resource outside library root')
    return p


def build(root):
    root=Path(root).resolve();base=root/'official_catalog/runs/all'
    source=base/'catalog.sqlite3'
    if not source.is_file():raise ValueError('Official catalog database is missing')
    out=root/'official_catalog/library';out.mkdir(parents=True,exist_ok=True)
    destination=out/'hardware.sqlite3'
    if destination.exists():
        with read_db(destination) as old:
            if old.execute("SELECT value FROM meta WHERE key='schema'").fetchone()[0]!=SCHEMA:
                raise ValueError('Refusing to replace a foreign database')
    with read_db(source) as src:
        src.execute('BEGIN')
        public={r[0] for r in src.execute('SELECT url FROM hardware_index_products')}
        products={r[0]:json.loads(r[1]) for r in src.execute('SELECT url,record_json FROM products') if r[0] in public}
        asset_rows={r['url']:dict(r) for r in src.execute('SELECT * FROM assets')}
        product_assets=list(src.execute('SELECT product_url,asset_url FROM product_assets'))
        documents={r[0]:json.loads(r[1]) for r in src.execute('SELECT url,record_json FROM documents') if r[0].startswith(('https://docs.arduino.cc/tutorials/','https://docs.arduino.cc/libraries/'))}
        product_docs=list(src.execute('SELECT product_url,document_url FROM product_documents'))
    if not products:raise ValueError('No public hardware records; existing index retained')
    manifest=base/'step_inventory/inventory.json'
    model_data=json.loads(manifest.read_text()) if manifest.is_file() else {'models':[],'hardware':[]}
    aliases={h['url']:h for h in model_data.get('hardware',[])}
    fingerprint=digest(json.dumps({'products':products,'assets':asset_rows,'documents':documents,'models':model_data},ensure_ascii=False,sort_keys=True))
    fd,tmp=tempfile.mkstemp(prefix='hardware-',suffix='.sqlite3',dir=out);os.close(fd)
    db=sqlite3.connect(tmp)
    try:
        db.executescript('''
        CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT);
        CREATE TABLE hardware(candidate_id TEXT PRIMARY KEY,url TEXT UNIQUE,title TEXT,primary_text TEXT,search_text TEXT,record_json TEXT);
        CREATE TABLE assets(asset_id TEXT PRIMARY KEY,url TEXT,local_path TEXT,sha256 TEXT,mime TEXT,label TEXT,role TEXT,bytes INTEGER,state TEXT,source_json TEXT);
        CREATE TABLE hardware_assets(candidate_id TEXT,asset_id TEXT,PRIMARY KEY(candidate_id,asset_id));
        CREATE TABLE documents(document_id TEXT PRIMARY KEY,url TEXT,title TEXT,text TEXT,sha256 TEXT);
        CREATE TABLE hardware_documents(candidate_id TEXT,document_id TEXT,PRIMARY KEY(candidate_id,document_id));
        ''')
        ids={u:digest('arduino-hardware\0'+u) for u in products}
        by_url={};models={};doc_ids={}
        def add_asset(url,path,sha,mime,label,role,size,state,extra=None):
            aid=digest('official-asset\0'+url+'\0'+(sha or 'unavailable'))
            relative=None
            if path:
                p=confined(root,path)
                if p.is_file():relative=str(p.relative_to(root))
                else:state='missing'
            db.execute('INSERT OR IGNORE INTO assets VALUES(?,?,?,?,?,?,?,?,?,?)',(aid,url,relative,sha,mime,label,role,size,state,json.dumps(extra or {},ensure_ascii=False)))
            return aid
        mimes={'.pdf':'application/pdf','.zip':'application/zip','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.step':'application/step','.stp':'application/step','.txt':'text/plain'}
        for url,a in asset_rows.items():
            path=base/a['local_path'] if a.get('local_path') else None
            ext=Path(a.get('local_path') or url).suffix.lower()
            by_url[url]=add_asset(url,path,a.get('sha256'),mimes.get(ext,'application/octet-stream'),a.get('label') or Path(url).name,a['role'],a.get('bytes'),a['state'])
        for owner,url in product_assets:
            if owner in ids and url in by_url:db.execute('INSERT OR IGNORE INTO hardware_assets VALUES(?,?)',(ids[owner],by_url[url]))
        for m in model_data.get('models',[]):
            path=confined(root,m['model_path'])
            if not path.is_file():continue
            sha=m['sha256']
            # A stale inventory must never bind geometry from a changed file.
            if digest(path.read_bytes())!=sha:continue
            mid=add_asset('urn:sha256:'+sha,path,sha,'application/step',path.name,'step_model',path.stat().st_size,'downloaded',{'sources':m.get('sources',[]),'notes':m.get('notes',[]),'appliesTo':m.get('hardware',[])})
            models[mid]=m
            archive_urls={s['archive_url'] for s in m.get('sources',[])}
            owners={u for u,a in product_assets if a in archive_urls and u in ids}
            for owner in owners:db.execute('INSERT OR IGNORE INTO hardware_assets VALUES(?,?)',(ids[owner],mid))
        for url,d in documents.items():
            text=d.get('text','');did=digest('official-document\0'+url+'\0'+digest(text))
            db.execute('INSERT INTO documents VALUES(?,?,?,?,?)',(did,url,d.get('title') or url,text,digest(text)));doc_ids[url]=did
        for owner,url in product_docs:
            if owner in ids and url in doc_ids:db.execute('INSERT OR IGNORE INTO hardware_documents VALUES(?,?)',(ids[owner],doc_ids[url]))
        for url,p in products.items():
            cid=ids[url];spec=p.get('technical_specification_source','')
            params=[]
            for row in p.get('parameter_rows',[]):
                quote=row.get('source_line','')
                if quote and quote in spec:
                    params.append({'name':' / '.join(x for x in [row.get('group'),row.get('name')] if x),'value':row.get('value',''),'quote':quote,'verification':'requires_verification' if 'TO VERIFY' in quote else 'manufacturer_stated'})
            a=aliases.get(url,{})
            display=' '.join(str(a.get(k,'')) for k in ['group','function','application_examples'])
            primary=' '.join([p['name'],*p.get('skus',[]),display,p.get('description','')])
            doc_text='\n'.join(documents[d]['text'] for owner,d in product_docs if owner==url and d in documents)
            incomplete=any(asset_rows[v]['state']!='downloaded' for owner,v in product_assets if owner==url and v in asset_rows)
            record={'candidateId':cid,'sourceType':'official_hardware','sourceName':'Arduino 官方硬件','title':p['name'],'url':url,'skus':p.get('skus',[]),'asin':'','description':p.get('description',''),'functionSummary':a.get('function',''),'applicationExamples':a.get('application_examples',''),'category':(p.get('official_metadata') or {}).get('fields',{}).get('category'),'parameters':params,'parameterCount':len(params),'sourceText':p.get('text',''),'specificationSource':spec,'capturedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'rawHash':digest(json.dumps(p,ensure_ascii=False,sort_keys=True)),'fit':'candidate','reviewNotes':['官方资料不是实测；STEP 包络检查不验证安装孔、插头／线缆空间或电气兼容。'],'geometryVerified':False,'evidenceStatus':'manufacturer_documentation_not_physical_validation','originFingerprint':fingerprint,'sourceIncomplete':incomplete}
            db.execute('INSERT INTO hardware VALUES(?,?,?,?,?,?)',(cid,url,p['name'],primary,primary+'\n'+spec+'\n'+doc_text,json.dumps(record,ensure_ascii=False)))
        stats={'hardware':len(products),'stepModels':len(models),'documents':db.execute('SELECT count(*) FROM documents').fetchone()[0],'downloadedAssets':db.execute("SELECT count(*) FROM assets WHERE state='downloaded'").fetchone()[0]}
        for key,value in {'schema':SCHEMA,'built_at':dt.datetime.now(dt.timezone.utc).isoformat(),'fingerprint':fingerprint,'stats':json.dumps(stats),'source_scope':'https://docs.arduino.cc/hardware/'}.items():db.execute('INSERT INTO meta VALUES(?,?)',(key,value))
        db.commit();db.close()
        if destination.exists():
            backups=out/'backups';backups.mkdir(exist_ok=True)
            stamp=dt.datetime.now().strftime('%Y%m%d-%H%M%S-%f')
            with read_db(destination) as src,sqlite3.connect(backups/(stamp+'.sqlite3')) as bak:src.backup(bak)
        os.replace(tmp,destination)
        (out/'integration-report.json').write_text(json.dumps({'schema':SCHEMA,'fingerprint':fingerprint,**stats,'sourceUnchanged':True,'geometryVerifiedAutomatically':False},ensure_ascii=False,indent=2))
        return {'database':str(destination),**stats}
    finally:
        db.close()
        if Path(tmp).exists():Path(tmp).unlink()


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--root',required=True)
    print(json.dumps(build(parser.parse_args().root),ensure_ascii=False))
