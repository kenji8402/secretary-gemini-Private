// AI秘書 ローカルサーバー（端末で自動振り分け + 手動切替対応）
//   ・PC(デスクトップ)  → LM Studio(同じPC)
//   ・スマホ(モバイル)   → Gemini(既存のVercel)へ転送
//   ・アプリ内トグルやリクエストの backend 指定にも対応
//   ・追加ライブラリ不要（Node.js 18以上で動作）
//
// 使い方:  node server.mjs
// 環境変数:  PORT(既定8080) / LMSTUDIO_URL(既定 http://localhost:1234) /
//            GEMINI_URL(既定 https://secretary-gemini.vercel.app)

import http from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, extname, normalize, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DIST = join(__dirname, 'dist')
const PORT = process.env.PORT || 8080
const LM_URL = (process.env.LMSTUDIO_URL || 'http://localhost:1234').replace(/\/$/, '')
const GEMINI_URL = (process.env.GEMINI_URL || 'https://secretary-gemini.vercel.app').replace(/\/$/, '')

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2', '.map': 'application/json',
}

// PCの既定の接続先（/switch で変更）。'lmstudio' か 'gemini'
let desktopBackend = 'lmstudio'

function isMobile(req) {
  const ua = req.headers['user-agent'] || ''
  return /Mobi|Android|iPhone|iPad|iPod|Windows Phone|webOS|BlackBerry/i.test(ua)
}

let cachedModel = null
async function getModel() {
  if (cachedModel) return cachedModel
  try {
    const r = await fetch(LM_URL + '/v1/models')
    const d = await r.json()
    cachedModel = (d && d.data && d.data[0] && d.data[0].id) || 'local-model'
  } catch {
    cachedModel = 'local-model'
  }
  return cachedModel
}

function cleanText(text) {
  return String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\|[^|]*\|>/g, '')
    .trim()
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' })
  res.end(JSON.stringify(obj))
}

// ── PC: LM Studio(OpenAI形式)で応答
async function answerWithLMStudio(body, res) {
  const messages = body.messages || []
  const system = body.system
  const json = body.json || false
  const max_tokens = body.max_tokens

  const lmMessages = []
  if (system) {
    const sys = json
      ? system + '\n\n必ず有効なJSONのみを出力してください。前置き・説明・コードブロック記号は一切不要です。'
      : system
    lmMessages.push({ role: 'system', content: sys })
  }
  for (const m of messages) {
    const content = typeof m.content === 'string' ? m.content : ((m.content && m.content[0] && m.content[0].text) || '')
    lmMessages.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content })
  }

  const model = await getModel()
  const base = {
    model,
    messages: lmMessages,
    max_tokens: max_tokens || (json ? 8000 : 4000),
    temperature: json ? 0.2 : 0.7,
    stream: false,
  }
  // JSON生成時は (1)JSON強制あり → 失敗したら (2)強制なし の順で試す
  const attempts = json
    ? [Object.assign({}, base, { response_format: { type: 'json_object' } }), base]
    : [base]

  let lastErr = ''
  for (let i = 0; i < attempts.length; i++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 180000)
    try {
      const r = await fetch(LM_URL + '/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(attempts[i]),
        signal: controller.signal,
      })
      clearTimeout(timer)
      const data = await r.json().catch(() => ({}))
      if (!r.ok || data.error) {
        lastErr = (data.error && (data.error.message || data.error)) || ('HTTP ' + r.status)
        console.error('[LM Studio エラー] 試行' + (i + 1) + ': ' + lastErr)
        continue
      }
      const msg = data.choices && data.choices[0] && data.choices[0].message
      let text = cleanText(msg && msg.content)
      if (!text) text = cleanText(msg && msg.reasoning_content)
      if (!text) {
        lastErr = 'モデルからの応答が空でした'
        console.error('[LM Studio] 応答が空（試行' + (i + 1) + '）')
        continue
      }
      // JSON生成時はモデルが前後に付ける説明文を除き、{ ... } 部分だけ抜き出す
      if (json) {
        const a = text.indexOf('{')
        const b = text.lastIndexOf('}')
        if (a !== -1 && b > a) text = text.slice(a, b + 1)
        let ok = false
        try { JSON.parse(text); ok = true } catch {}
        if (!ok) {
          lastErr = 'モデルが有効なJSONを生成できませんでした（出力が不完全）'
          console.error('[LM Studio] JSON不正（試行' + (i + 1) + '）')
          if (i < attempts.length - 1) continue
        }
      }
      return sendJson(res, 200, { content: [{ type: 'text', text }] })
    } catch (e) {
      clearTimeout(timer)
      if (e.name === 'AbortError') {
        console.error('[LM Studio] タイムアウト(3分)')
        return sendJson(res, 504, { error: 'LM Studioの応答が3分以内に返りませんでした。モデルのサイズやPC性能をご確認ください。' })
      }
      console.error('[LM Studio 接続不可] ' + e.message + '（接続先: ' + LM_URL + '）')
      return sendJson(res, 502, { error: 'LM Studioに接続できません（' + LM_URL + '）。LM StudioのStart Serverとモデルの読み込みを確認してください。' })
    }
  }
  return sendJson(res, 502, { error: 'LM Studioがエラーを返しました: ' + lastErr })
}

// ── スマホ等: 既存のVercel(Gemini)へそのまま転送
async function answerWithGemini(rawBody, res) {
  try {
    const r = await fetch(GEMINI_URL + '/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: rawBody,
    })
    const text = await r.text()
    res.writeHead(r.status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' })
    res.end(text)
  } catch (e) {
    return sendJson(res, 502, { error: 'Gemini(' + GEMINI_URL + ')へ接続できませんでした。インターネット接続をご確認ください。' })
  }
}

// ── /api/gemini : 端末・設定で振り分け
async function handleApi(req, res) {
  let raw = ''
  for await (const c of req) raw += c

  let body = {}
  try { body = JSON.parse(raw || '{}') } catch {}

  // 優先順位: スマホは常にGemini → リクエストのbackend指定 → PCの既定(desktopBackend)
  let target
  if (isMobile(req)) target = 'gemini'
  else if (body.backend === 'gemini' || body.backend === 'lmstudio') target = body.backend
  else target = desktopBackend

  if (target === 'gemini') return answerWithGemini(raw, res)
  return answerWithLMStudio(body, res)
}

// ── /switch : PCの接続先を切り替えるミニ画面
function handleSwitch(req, res) {
  const u = new URL(req.url, 'http://localhost')
  const to = u.searchParams.get('to')
  if (to === 'lmstudio' || to === 'gemini') desktopBackend = to

  const isLM = desktopBackend === 'lmstudio'
  const lmBg = isLM ? '#6C9FFF' : '#2a3357'
  const lmFg = isLM ? '#0A0E1A' : '#B8C7FF'
  const gmBg = isLM ? '#2a3357' : '#6C9FFF'
  const gmFg = isLM ? '#B8C7FF' : '#0A0E1A'
  const nowLabel = isLM ? 'LM Studio（ローカル・無料）' : 'Gemini（クラウド）'
  const lmMark = isLM ? '&#10003; ' : ''
  const gmMark = isLM ? '' : '&#10003; '

  const html = [
    '<!doctype html><html lang="ja"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>接続先の切り替え</title>',
    '<style>',
    'body{margin:0;font-family:"Segoe UI",sans-serif;background:#0A0E1A;color:#B8C7FF;display:flex;min-height:100vh;align-items:center;justify-content:center}',
    '.card{background:#1E2740;padding:32px 36px;border-radius:16px;max-width:380px;width:90%;box-shadow:0 8px 40px rgba(0,0,0,.5);text-align:center}',
    'h1{font-size:18px;margin:0 0 4px}',
    '.sub{font-size:13px;opacity:.6;margin-bottom:20px}',
    '.now{font-size:14px;margin:18px 0;padding:10px;border-radius:10px;background:#0A0E1A}',
    '.now b{color:#6C9FFF}',
    'a.btn{display:block;text-decoration:none;padding:14px;border-radius:12px;margin:10px 0;font-weight:600;font-size:15px}',
    'a.home{display:inline-block;margin-top:16px;color:#6C9FFF;font-size:13px}',
    '</style></head><body><div class="card">',
    '<h1>PCの接続先 切り替え</h1>',
    '<div class="sub">スマホは常にGeminiです（この設定はPC用）</div>',
    '<div class="now">現在のPCの接続先：<b>' + nowLabel + '</b></div>',
    '<a class="btn" style="background:' + lmBg + ';color:' + lmFg + '" href="/switch?to=lmstudio">' + lmMark + 'LM Studio を使う</a>',
    '<a class="btn" style="background:' + gmBg + ';color:' + gmFg + '" href="/switch?to=gemini">' + gmMark + 'Gemini を使う</a>',
    '<a class="home" href="/">&#8592; アプリに戻る</a>',
    '</div></body></html>',
  ].join('\n')

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(html)
}

// ── 静的ファイル配信（SPA。未知パスはindex.htmlへ）
async function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0])
  if (urlPath === '/') urlPath = '/index.html'
  let filePath = normalize(join(DIST, urlPath))
  if (!filePath.startsWith(DIST)) { res.writeHead(403); return res.end('Forbidden') }
  try {
    const s = await stat(filePath)
    if (s.isDirectory()) filePath = join(filePath, 'index.html')
    const data = await readFile(filePath)
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' })
    res.end(data)
  } catch {
    try {
      const data = await readFile(join(DIST, 'index.html'))
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(data)
    } catch {
      res.writeHead(404)
      res.end('distフォルダが見つかりません。先に npm run build を実行してください。')
    }
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    })
    return res.end()
  }
  if (req.url.startsWith('/api/gemini') && req.method === 'POST') return handleApi(req, res)
  if (req.url.startsWith('/switch')) return handleSwitch(req, res)
  return serveStatic(req, res)
})

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n==============================================')
  console.log('  AI秘書サーバー 起動しました')
  console.log('  このPC(→LM Studio):  http://localhost:' + PORT)
  console.log('  スマホ(→Gemini):      http://(このPCのIP):' + PORT)
  console.log('  接続先の切替:         http://localhost:' + PORT + '/switch')
  console.log('  LM Studio: ' + LM_URL)
  console.log('  Gemini転送先: ' + GEMINI_URL)
  console.log('  終了するには Ctrl + C')
  console.log('==============================================\n')
})
