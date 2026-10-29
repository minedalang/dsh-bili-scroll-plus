"""Meme approval/migration/edit cycles without Bilibili access."""
import importlib.util, json, sqlite3, subprocess, sys, tempfile, unittest
from datetime import datetime
from contextlib import closing
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
SCRIPT=ROOT/'lib/meme-memory-admin.py'
class MemeAdminTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.home=Path(self.tmp.name);self.db=self.home/'meme-memory.sqlite3'
        self.conn=sqlite3.connect(str(self.db));self.conn.execute('''CREATE TABLE memes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,key TEXT UNIQUE NOT NULL,name TEXT NOT NULL,aliases TEXT NOT NULL DEFAULT '',
          kind TEXT NOT NULL DEFAULT '梗',meaning TEXT NOT NULL,confidence TEXT NOT NULL DEFAULT '待核实',
          created_at TEXT NOT NULL,updated_at TEXT NOT NULL)''')
        self.conn.execute('''CREATE TABLE meme_sources (meme_id INTEGER,bvid TEXT,evidence_type TEXT,evidence TEXT,noted_at TEXT,PRIMARY KEY(meme_id,bvid))''')
        self.conn.execute("INSERT INTO memes(key,name,aliases,kind,meaning,confidence,created_at,updated_at) VALUES ('奶蛙','奶蛙','奶娃','角色','人物造型不明','待核实','t','t')")
        self.conn.execute("INSERT INTO meme_sources VALUES (1,'BV1pXHK6mE6z','字幕','奶蛙','t')")
        self.conn.commit();self.conn.close()
    def call(self,action,value):
        x=json.loads(subprocess.check_output([sys.executable,str(SCRIPT),str(self.home),action,json.dumps(value,ensure_ascii=False) if isinstance(value,dict) else str(value)]))
        return x
    def test_legacy_upgrades_to_approved_without_loss(self):
        a=self.call('list','')
        self.assertTrue(a['ok']);self.assertEqual(a['counts']['approved'],1)
        self.assertEqual(a['entries'][0]['sources'][0]['bvid'],'BV1pXHK6mE6z')
    def test_review_reject_approve_and_edit(self):
        self.assertEqual(self.call('review',{'id':1,'status':'rejected'})['status'],'rejected')
        self.assertEqual(self.call('review',{'id':1,'status':'approved'})['status'],'approved')
        p={'id':1,'name':'奶蛙二创','aliases':'奶娃','meaning':'修正后的解释','kind':'角色','confidence':'有文字依据'}
        self.assertTrue(self.call('edit',p)['updated'])
        row=self.call('list','奶蛙二创')['entries'][0]
        self.assertEqual(row['meaning'],'修正后的解释');self.assertEqual(len(row['sources']),1)
        self.assertEqual(row['review_status'],'approved')
    def test_secret_or_duplicate_name_edit_blocked(self):
        x={'id':1,'name':'奶蛙','aliases':'','meaning':'cookie=secret','kind':'梗','confidence':'待核实'}
        self.assertFalse(self.call('edit',x)['ok'])
        self.assertEqual(self.call('list','')['entries'][0]['meaning'],'人物造型不明')
        self.assertFalse(self.call('review',{'id':1,'status':'invalid'})['ok'])
    def test_delete_source_and_meme(self):
        self.assertTrue(self.call('delete',1)['deleted'])
        self.assertEqual(self.call('list','')['total'],0)
        with closing(sqlite3.connect(self.db)) as conn:
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM meme_sources').fetchone()[0],0)
