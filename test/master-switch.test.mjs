import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { apply } from '../index.js'

// 真正通过假宿主 HTTP 路由保存配置；不是仅检验字符串是否存在。
test('总开关可关闭/重启后保持/恢复：关闭时不能跑一轮，旧批量收藏已停用', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-master-switch-'))
  let route
  const ctx = {
    get(key) { return key === 'dshHomePath' ? (...parts) => join(home, ...parts) : undefined },
    logger: {info(){},warn(){}},
    tools: {register(){}},
    webServer: {register(spec) {route=spec;return {dispose(){}}}},
    effect(callback) {return callback()},
    settings: {describe(){return []}},
  }
  try {
    apply(ctx,{})
    assert.ok(route?.handler)
    const request = async (method,path,body) => {
      const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[])
      req.method=method;req.url=path;req.headers={host:'localhost'}
      let code,result
      const res={writeHead(c){code=c},end(out){result=JSON.parse(out)}}
      await route.handler(req,res)
      assert.equal(code,200)
      return result
    }
    const state = join(home,'bili-duty')
    const pause=join(state,'.bili-duty-paused')
    assert.equal(existsSync(pause),false)
    const off=await request('POST','/api/bili-duty/config',{masterEnabled:false})
    assert.equal(off.config.masterEnabled,false)
    assert.ok(existsSync(pause))
    const saved=JSON.parse(readFileSync(join(state,'config.json'),'utf8'))
    assert.equal(saved.masterEnabled,false)
    assert.ok(saved._set.includes('masterEnabled'))
    const status=await request('GET','/api/bili-duty/status')
    assert.equal(status.config.masterEnabled,false)
    const run=await request('POST','/api/bili-duty/run')
    assert.equal(run.started,false)
    assert.equal(run.paused,true)
    const favorite=await request('POST','/api/bili-duty/fav-today',{})
    assert.match(favorite.error,/整轮批量收藏已经取消/)
    const on=await request('POST','/api/bili-duty/config',{masterEnabled:true})
    assert.equal(on.config.masterEnabled,true)
    assert.equal(existsSync(pause),false)
  }finally {rmSync(home,{recursive:true,force:true})}
})

test('总开关覆盖定时器、后台互动和 Python MCP 外发', () => {
  const index=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  const scheduler=readFileSync(new URL('../lib/interaction-scheduler.mjs',import.meta.url),'utf8')
  const mcp=readFileSync(new URL('../vendor/bilibili-mcp/mcp_server.py',import.meta.url),'utf8')
  const sidecar=readFileSync(new URL('../lib/favops.py',import.meta.url),'utf8')
  assert.match(index,/cfg\.masterEnabled !== true \|\| !cfg\.peakValley/)
  assert.match(index,/enabled: cfg\.masterEnabled === true && cfg\.dmWatch/)
  assert.match(index,/watchReplies: cfg\.masterEnabled === true && \(cfg\.commentWatchReplies === true \|\| cfg\.ownerCommentAgentEnabled === true\)/)
  assert.doesNotMatch(index,/favToday\('auto'\)/)
  assert.match(mcp,/_guard\('bili_video_like'\)/)
  assert.match(mcp,/_guard\('bili_video_collect'\)/)
  assert.match(index,/if \('masterEnabled' in args\.patch\) return/)
  assert.match(scheduler,/if\(cfg\.masterEnabled===false\)return/)
  assert.match(mcp,/bili-duty-paused/)
  assert.match(sidecar,/bili-duty-paused/)
})
