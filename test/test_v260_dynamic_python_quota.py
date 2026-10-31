"""Publishing gate: real SQLite quota reservation, fake HTTP only; no B站 network."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('daily_dynamic_publish', ROOT / 'lib/daily-dynamic-publish.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

class FakeReply:
    def __enter__(self): return self
    def __exit__(self, *args): return False
    def read(self): return json.dumps({'code': 0, 'data': {'dyn_id_str': 'fake-only'}}).encode('utf8')

class QuotaSafetyTests(unittest.TestCase):
    def test_configured_limit_and_text_length_match_js(self):
        with tempfile.TemporaryDirectory() as temp:
            home = Path(temp)
            cred = home / 'bili_credential.json'
            cred.write_text(json.dumps({'bili_jct':'dummy', 'sessdata':'dummy'}), encoding='utf8')
            calls=[]
            def fake_urlopen(req, timeout=0):
                calls.append((req.full_url,timeout))
                return FakeReply()
            with patch.object(MODULE.urllib.request, 'urlopen', side_effect=fake_urlopen):
                # A 20-char draft was previously accepted by JS but rejected by Python.
                text = '这是鱼鱼的日常小动态呀，今天还挺开心的。'
                self.assertTrue(15 <= len(text) < 25)
                self.assertEqual(MODULE.publish(home,cred,text,2,True)['status'],'api_accepted_unverified')
                self.assertEqual(MODULE.publish(home,cred,text,2,True)['status'],'api_accepted_unverified')
                self.assertEqual(MODULE.publish(home,cred,text,2,True)['status'],'daily_limit')
                self.assertEqual(len(calls),2)
                # Lowering cap after two reservations does not reset the SQLite ledger.
                self.assertEqual(MODULE.publish(home,cred,text,1,True)['status'],'daily_limit')
                self.assertEqual(MODULE.publish(home,cred,text,0,True)['status'],'daily_limit')
                self.assertEqual(len(calls),2)

    def test_disabled_and_missing_credentials_never_send(self):
        with tempfile.TemporaryDirectory() as temp:
            home=Path(temp);cred=home/'missing.json'
            with patch.object(MODULE.urllib.request,'urlopen',side_effect=AssertionError('must not contact B站')):
                self.assertEqual(MODULE.publish(home,cred,'有真实经历支撑的合适动态内容哈哈哈哈哈哈',5,True)['status'],'missing_credentials')
                self.assertEqual(MODULE.publish(home,cred,'有真实经历支撑的合适动态内容哈哈哈哈哈哈',5,False)['status'],'disabled')

if __name__=='__main__': unittest.main()
