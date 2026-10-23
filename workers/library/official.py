"""Bounded read-only adapter for indexed official hardware and linked resources."""
import hashlib
import json
from pathlib import Path
import sqlite3


def query_official(root,request,needles):
    path=root/'official_catalog/library/hardware.sqlite3'
    empty={'candidates':[],'record':None,'total':0,'stats':{},'fingerprint':'','asset':None}
    if not path.is_file():return empty
    db=sqlite3.connect(path.resolve().as_uri()+'?mode=ro',uri=True,timeout=3);db.row_factory=sqlite3.Row
    try:
        meta=dict(db.execute('SELECT key,value FROM meta'))
        if meta.get('schema')!='dreamatic-official-hardware-v1':raise ValueError('Unknown official library schema')
        wanted=request.get('candidateId');aid=request.get('assetId');did=request.get('documentId')
        all_rows=db.execute('SELECT candidate_id,primary_text,search_text FROM hardware').fetchall()
        scores=[]
        for row in all_rows:
            primary=row['primary_text'].lower();text=row['search_text'].lower()
            score=sum(8 if term in primary else 1 if term in text else 0 for term in needles)
            if wanted==row['candidate_id'] or (not wanted and (score or not needles)):scores.append((score,row['candidate_id']))
        scores.sort(reverse=True)
        selected=[]
        for score,cid in scores[:1 if wanted else 8]:
            row=db.execute('SELECT record_json FROM hardware WHERE candidate_id=?',(cid,)).fetchone();record=json.loads(row[0])
            attachments=[dict(a) for a in db.execute('SELECT a.* FROM assets a JOIN hardware_assets h USING(asset_id) WHERE h.candidate_id=? ORDER BY CASE role WHEN \'step_model\' THEN 0 WHEN \'datasheet\' THEN 1 WHEN \'pinout\' THEN 2 WHEN \'schematics\' THEN 3 WHEN \'cad\' THEN 4 ELSE 5 END,label',(cid,))]
            docs=[dict(d) for d in db.execute('SELECT d.document_id,d.url,d.title,d.sha256 FROM documents d JOIN hardware_documents h USING(document_id) WHERE h.candidate_id=?',(cid,))]
            def summary(a):
                return {'assetId':a['asset_id'],'url':a['url'],'label':a['label'],'role':a['role'],'mime':a['mime'],'bytes':a['bytes'],'sha256':a['sha256'],'state':a['state']}
            record['models']=[summary(a) for a in attachments if a['role']=='step_model']
            record['modelCount']=len(record['models']);record['documentCount']=len(docs);record['assetCount']=len(attachments)
            if wanted:
                record['documents']=docs
                record['assets']=[summary(a) for a in attachments[:120]]
                if did:
                    doc=db.execute('SELECT d.* FROM documents d JOIN hardware_documents h USING(document_id) WHERE h.candidate_id=? AND d.document_id=?',(cid,did)).fetchone()
                    if not doc:raise LookupError('Document is not linked to this hardware')
                    start=max(0,min(int(request.get('offset',0)),10_000_000));text=doc['text']
                    record['document']={'documentId':did,'url':doc['url'],'title':doc['title'],'sha256':doc['sha256'],'sourceText':text[start:start+40000],'offset':start,'nextOffset':start+40000 if len(text)>start+40000 else None,'totalCharacters':len(text)}
                if aid:
                    asset=next((a for a in attachments if a['asset_id']==aid),None)
                    if not asset or asset['state']!='downloaded' or not asset['local_path']:raise LookupError('Asset unavailable or not linked to this hardware')
                    p=(root/asset['local_path']).resolve()
                    if not p.is_relative_to(root.resolve()) or not p.is_file():raise ValueError('Asset path outside library or missing')
                    empty['asset']={**summary(asset),'path':str(p),'provenance':json.loads(asset['source_json'])}
                record['sourceText']=record['sourceText'][:80000]
            else:
                record['parameters']=record['parameters'][:5]
                record.pop('sourceText',None);record.pop('specificationSource',None)
            selected.append(record)
        return {**empty,'candidates':selected if not wanted else [],'record':selected[0] if wanted and selected else None,'total':len(all_rows),'stats':json.loads(meta['stats']),'fingerprint':meta['fingerprint']}
    finally:db.close()
