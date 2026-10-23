import hashlib
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

from import_official import build
from query import query


URL='https://docs.arduino.cc/hardware/modulino-thermo/'


def fixture(root,model=None):
    root=Path(root);base=root/'official_catalog/runs/all';(base/'files').mkdir(parents=True)
    (base/'step_inventory/models').mkdir(parents=True)
    step=base/'step_inventory/models/thermo.step'
    step.write_bytes(Path(model).read_bytes() if model else b'ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;')
    sha=hashlib.sha256(step.read_bytes()).hexdigest()
    spec='Power:\n  Voltage: 3.3 V\n  Current: 10 mA # TO VERIFY'
    p={'url':URL,'name':'Modulino Thermo','description':'Temperature and humidity sensor','skus':['ABX00103'],'text':'Temperature and humidity sensor\n'+spec,'technical_specification_source':spec,'parameter_rows':[{'group':'Power','name':'Voltage','value':'3.3 V','source_line':'  Voltage: 3.3 V'},{'group':'Power','name':'Current','value':'10 mA # TO VERIFY','source_line':'  Current: 10 mA # TO VERIFY'}],'official_metadata':{'fields':{'category':'accessory'}}}
    archive='https://docs.arduino.cc/static/thermo-step.zip'
    manual='https://docs.arduino.cc/tutorials/modulino-thermo/guide/'
    with sqlite3.connect(base/'catalog.sqlite3') as c:
        c.executescript('''CREATE TABLE hardware_index_products(url TEXT);
        CREATE TABLE products(url TEXT,record_json TEXT);
        CREATE TABLE assets(url TEXT,role TEXT,label TEXT,state TEXT,local_path TEXT,sha256 TEXT,bytes INTEGER);
        CREATE TABLE product_assets(product_url TEXT,asset_url TEXT);
        CREATE TABLE documents(url TEXT,record_json TEXT);
        CREATE TABLE product_documents(product_url TEXT,document_url TEXT);''')
        c.execute('INSERT INTO hardware_index_products VALUES(?)',(URL,));c.execute('INSERT INTO products VALUES(?,?)',(URL,json.dumps(p)))
        c.execute('INSERT INTO assets VALUES(?,?,?,?,?,?,?)',(archive,'cad','CAD archive','pending',None,None,None))
        c.execute('INSERT INTO product_assets VALUES(?,?)',(URL,archive))
        c.execute('INSERT INTO documents VALUES(?,?)',(manual,json.dumps({'title':'Thermo User Manual','text':'Temperature range and detailed wiring instructions.','url':manual})))
        c.execute('INSERT INTO product_documents VALUES(?,?)',(URL,manual))
    data={'models':[{'sha256':sha,'model_path':str(step.resolve()),'bytes':step.stat().st_size,'sources':[{'archive_url':archive,'member':'thermo.step','archive':'archive.zip'}],'hardware':[]}],'hardware':[{'url':URL,'group':'传感器','function':'测量温度和湿度','application_examples':'温湿度监控'}]}
    (base/'step_inventory/inventory.json').write_text(json.dumps(data))
    return step


class OfficialLibraryTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.step=fixture(self.root)
    def tearDown(self):self.temp.cleanup()

    def test_idempotent_import_keeps_sources_and_geometry_status(self):
        source=self.root/'official_catalog/runs/all/catalog.sqlite3';before=hashlib.sha256(source.read_bytes()).hexdigest()
        first=build(self.root);second=build(self.root)
        self.assertEqual(first,second);self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(),before)
        result=query(self.root,{'query':'温湿度'})
        self.assertEqual(result['officialHardware']['hardware'],1)
        self.assertEqual(len(result['candidates']),1)
        p=result['candidates'][0];self.assertEqual(p['modelCount'],1);self.assertFalse(p['geometryVerified'])
        d=query(self.root,{'candidateId':p['candidateId']})['record']
        self.assertEqual(d['parameters'][0]['value'],'3.3 V')
        self.assertEqual(d['parameters'][1]['verification'],'requires_verification')
        self.assertEqual(d['assets'][-1]['state'],'pending')
        self.assertEqual(len(list((self.root/'official_catalog/library/backups').iterdir())),1)

    def test_bound_manual_and_resource_read_without_arbitrary_paths(self):
        build(self.root);p=query(self.root,{'query':'ABX00103'})['candidates'][0]
        record=query(self.root,{'candidateId':p['candidateId']})['record']
        doc=query(self.root,{'candidateId':p['candidateId'],'documentId':record['documents'][0]['document_id']})['record']['document']
        self.assertIn('wiring',doc['sourceText'])
        with self.assertRaises(LookupError):query(self.root,{'candidateId':p['candidateId'],'documentId':'f'*64})
        with self.assertRaises(LookupError):query(self.root,{'candidateId':p['candidateId'],'assetId':'f'*64})
        resource=query(self.root,{'candidateId':p['candidateId'],'assetId':record['models'][0]['assetId']})['asset']
        self.assertEqual(Path(resource['path']),self.step.resolve())

    def test_source_path_escape_rejected_and_existing_index_retained(self):
        build(self.root);dest=self.root/'official_catalog/library/hardware.sqlite3';before=dest.read_bytes()
        m=self.root/'official_catalog/runs/all/step_inventory/inventory.json';data=json.loads(m.read_text());data['models'][0]['model_path']='/private/etc/hosts';m.write_text(json.dumps(data))
        with self.assertRaises(ValueError):build(self.root)
        self.assertEqual(dest.read_bytes(),before)

    def test_stale_model_hash_is_not_indexed(self):
        self.step.write_bytes(self.step.read_bytes()+b'changed')
        result=build(self.root)
        self.assertEqual(result['stepModels'],0)
        self.assertEqual(query(self.root,{'query':'Thermo'})['candidates'][0]['modelCount'],0)


if __name__=='__main__':unittest.main()
