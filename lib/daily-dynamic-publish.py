#!/usr/bin/env python3
"""v2.4.85: Fixed-path, quota-checked Bilibili text dynamic publisher. Never callable by model tools."""
import sys,json,re,sqlite3,datetime,urllib.request,urllib.parse
from contextlib import closing
from pathlib import Path

def publish(home,cred_path,text,limit,enabled):
    home=Path(home).resolve();cred_path=Path(cred_path).resolve()
    if not enabled or (home/'.bili-duty-paused').exists():return {'status':'disabled'}
    if not cred_path.is_file() or cred_path.is_symlink():return {'status':'missing_credentials'}
    if not (25<=len(text)<=230) or re.search(r'https?://|\b(?:cookie|token|password|secret|sessdata)\b',text,re.I):return {'status':'invalid_text'}
    limit=max(0,min(10,int(limit)))
    if not limit:return {'status':'daily_limit'}
    cred=json.loads(cred_path.read_text('utf8'))
    csrf=str(cred.get('bili_jct') or '');sessdata=str(cred.get('sessdata') or '')
    if not csrf or not sessdata:return {'status':'missing_credentials'}
    folder=home/'daily-dynamic';folder.mkdir(parents=True,exist_ok=True)
    db=folder/'publish-quota.sqlite3'
    if db.is_symlink():return {'status':'unsafe_ledger'}
    today=datetime.date.today().isoformat()
    with closing(sqlite3.connect(db,timeout=8)) as conn, conn:
        conn.execute('CREATE TABLE IF NOT EXISTS attempts(day TEXT NOT NULL, id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL)')
        conn.execute('BEGIN IMMEDIATE')
        n=conn.execute('SELECT COUNT(*) FROM attempts WHERE day=?',(today,)).fetchone()[0]
        if n>=limit:
            conn.commit();return {'status':'daily_limit'}
        conn.execute('INSERT INTO attempts(day,at) VALUES(?,?)',(today,datetime.datetime.now().isoformat()))
        conn.commit()
    payload={'dyn_req':{'content':{'contents':[{'raw_text':text,'type':1,'biz_id':''}]},'scene':1}}
    url='https://api.bilibili.com/x/dynamic/feed/create/dyn?csrf='+urllib.parse.quote(csrf)
    request=urllib.request.Request(url,data=json.dumps(payload,ensure_ascii=False).encode('utf8'),headers={
        'Content-Type':'application/json','Cookie':'SESSDATA='+sessdata+'; bili_jct='+csrf,
        'User-Agent':'Mozilla/5.0','Referer':'https://t.bilibili.com/'},method='POST')
    try:
        with urllib.request.urlopen(request,timeout=12) as res:data=json.loads(res.read().decode('utf8'))
        if data.get('code')==0:return {'status':'api_accepted_unverified','dynamic_id':(data.get('data') or {}).get('dyn_id_str')}
        return {'status':'api_rejected','reason':str(data.get('message') or data.get('code'))[:100]}
    except Exception as exc:return {'status':'uncertain_no_retry','reason':str(exc)[:120]}

if __name__=='__main__':
    try:
        home,cred,limit,enabled=sys.argv[1:5]
        text=sys.stdin.read(1000).strip()
        print(json.dumps(publish(home,cred,text,int(limit),enabled=='1'),ensure_ascii=False))
    except Exception as exc:print(json.dumps({'status':'failed','reason':str(exc)[:120]},ensure_ascii=False))
