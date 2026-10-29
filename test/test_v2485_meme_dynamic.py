import importlib.util,json,sqlite3,tempfile,unittest
from contextlib import closing
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

def load(path,name):
    spec=importlib.util.spec_from_file_location(name,path)
    mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod);return mod

class V2485Test(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.home=Path(self.temp.name)
        self.meme=load(ROOT/'lib'/'meme-learning-admin.py','meme_learning_admin')
        self.daily=load(ROOT/'lib'/'daily-dynamic-publish.py','daily_dynamic_publish')
        db=self.home/'meme-memory.sqlite3'
        with closing(sqlite3.connect(db)) as c, c:
            c.execute('CREATE TABLE memes(id INTEGER PRIMARY KEY AUTOINCREMENT,key TEXT UNIQUE,name TEXT,aliases TEXT,kind TEXT,meaning TEXT,confidence TEXT,created_at TEXT,updated_at TEXT,review_status TEXT)')
            c.execute('CREATE TABLE meme_sources(meme_id INTEGER,bvid TEXT,evidence_type TEXT,evidence TEXT,noted_at TEXT,PRIMARY KEY(meme_id,bvid))')
            c.execute('CREATE TABLE meme_observations(id INTEGER PRIMARY KEY,name TEXT,bvid TEXT,evidence TEXT,evidence_type TEXT,created_at TEXT,status TEXT DEFAULT "pending",UNIQUE(name,bvid))')
            c.execute('INSERT INTO meme_observations(id,name,bvid,evidence,evidence_type,created_at) VALUES(1,"奶蛙","BV1234567890","奶蛙来了","字幕","2026-10-27")')
            c.execute('INSERT INTO meme_observations(id,name,bvid,evidence,evidence_type,created_at) VALUES(2,"奶蛙","BV0987654321","奶蛙在这里","评论","2026-10-27")')
    def tearDown(self):self.temp.cleanup()
    def test_two_sources_commit(self):
        r=self.meme.operate(self.home,'commit',{'entries':[{'name':'奶蛙','kind':'角色','meaning':'不同视频中出现的网络二创形象，具体背景待核实。','observation_ids':[1,2]}]})
        self.assertEqual(r['created'],1)
        with closing(sqlite3.connect(self.home/'meme-memory.sqlite3')) as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM meme_sources').fetchone()[0],2)
            self.assertEqual(c.execute('SELECT confidence FROM memes').fetchone()[0],'待核实')
    def test_one_source_rejected(self):
        r=self.meme.operate(self.home,'commit',{'entries':[{'name':'奶蛙','kind':'角色','meaning':'不同视频中出现的网络二创形象，具体背景待核实。','observation_ids':[1]}]})
        self.assertEqual(r['created'],0)
    def test_wrong_name_or_unknown_ids_rejected(self):
        r=self.meme.operate(self.home,'commit',{'entries':[{'name':'其他','kind':'角色','meaning':'不同视频中出现的网络二创形象，具体背景待核实。','observation_ids':[1,2]},{'name':'奶蛙','kind':'角色','meaning':'不同视频中出现的网络二创形象，具体背景待核实。','observation_ids':[1,99]}]})
        self.assertEqual(r['created'],0)
    def test_dynamic_disabled_no_publish(self):
        self.assertEqual(self.daily.publish(self.home,self.home/'no.json','今天又刷到美食视频，想分享一点感受。',1,False)['status'],'disabled')
        self.assertEqual(self.daily.publish(self.home,self.home/'no.json','今天又刷到美食视频，想分享一点感受。',1,True)['status'],'missing_credentials')

if __name__=='__main__':unittest.main()
