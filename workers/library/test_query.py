import hashlib
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from query import query


class LiveLibraryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.work = self.root / "jd_purchase/runs/amazon_batch"
        self.work.mkdir(parents=True)
        self.url = "https://www.amazon.com/dp/TEST123"
        self.raw = self.work / "raw.json"
        self.raw.write_text(json.dumps({"snapshot": {"asin": "TEST123", "url": self.url,
            "title": "USB fan", "features": ["Operating voltage 5V"], "parameters": ""}}))
        self.db = sqlite3.connect(self.work / "purchase.sqlite3")
        self.db.execute("CREATE TABLE snapshots (run_id,variant_id,asin,url,title,status,raw_path,captured_at)")
        self.db.execute("INSERT INTO snapshots VALUES (?,?,?,?,?,?,?,?)", ("run", "v1", "TEST123", self.url,
            "USB fan", "captured", str(self.raw), "2026-10-21"))
        self.db.commit()
        self.cid = hashlib.sha256(("run\0" + self.url).encode()).hexdigest()

    def tearDown(self):
        self.db.close()
        self.temp.cleanup()

    def extract(self, value="5V", quote="Operating voltage 5V"):
        self.raw.with_suffix(".flash.json").write_text(json.dumps({"result": {
            "asin": "TEST123", "url": self.url, "fit": "candidate", "parameters": [
                {"name": "voltage", "value": value, "quote": quote}]}}))

    def test_live_late_extraction_and_new_rows(self):
        first = query(self.root, {"query": "风扇"})
        self.assertEqual(len(first["candidates"]), 1)
        self.assertEqual(first["candidates"][0]["parameters"], [])
        self.extract()
        second = query(self.root, {"candidateId": self.cid})
        self.assertNotEqual(first["fingerprint"], second["fingerprint"])
        self.assertEqual(second["record"]["parameters"][0]["value"], "5V")
        self.assertFalse(second["record"]["geometryVerified"])
        self.db.execute("INSERT INTO snapshots SELECT 'run2',variant_id,asin,url,title,status,raw_path,captured_at FROM snapshots")
        self.db.commit()
        self.assertEqual(query(self.root, {"query": "fan"})["totalCaptured"], 2)

    def test_reject_unbound_or_other_sku_parameters(self):
        self.extract("12V", "Operating voltage 12V")
        self.assertEqual(query(self.root, {"candidateId": self.cid})["record"]["parameters"], [])
        self.extract()
        self.raw.write_text(json.dumps({"snapshot": {"asin": "OTHER", "url": self.url}}))
        self.assertIsNone(query(self.root, {"candidateId": self.cid})["record"])

    def test_excluded_and_incomplete_files_refresh(self):
        self.raw.with_suffix(".flash.json").write_text("{")
        self.assertEqual(query(self.root, {"query": "fan"})["skippedUnreadable"], 1)
        self.extract()
        self.assertEqual(len(query(self.root, {"query": "fan"})["candidates"]), 1)
        (self.work / "progress.json").write_text(json.dumps({"skipped": {"v1": {}}}))
        self.assertEqual(query(self.root, {"query": "fan"})["candidates"], [])

    def test_path_confinement_and_no_source_write(self):
        before = (self.work / "purchase.sqlite3").read_bytes()
        query(self.root, {"query": "fan"})
        self.assertEqual(before, (self.work / "purchase.sqlite3").read_bytes())
        outside = self.root / "private.json"
        outside.write_text(self.raw.read_text())
        self.db.execute("UPDATE snapshots SET raw_path=?", (str(outside),)); self.db.commit()
        self.assertIsNone(query(self.root, {"candidateId": self.cid})["record"])

    def test_templates_remain_separate(self):
        folder = self.root / "parts_library/data"; folder.mkdir(parents=True)
        with sqlite3.connect(folder / "parts_library.sqlite3") as db:
            db.execute("CREATE TABLE part_types (part_id,name_zh,name_en)")
            db.execute("CREATE TABLE variants (variant_id,part_id,label_zh,label_en,specs_json,verification_status)")
            db.execute("INSERT INTO part_types VALUES ('p','风扇','fan')")
            db.execute("INSERT INTO variants VALUES ('v','p','风扇目标','fan target','[]','unverified')")
        result = query(self.root, {"query": "风扇"})
        self.assertEqual(len(result["requirements"]), 1)
        self.assertEqual(result["requirements"][0]["evidenceStatus"], "requirement_template_not_product_evidence")
        self.assertEqual(len(result["candidates"]), 1)


if __name__ == "__main__":
    unittest.main()
