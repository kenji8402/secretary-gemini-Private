export const config = { runtime: 'edge' }

// Claude形式のpayloadを受け取り、Gemini APIに変換して呼び出す互換レイヤー
export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'GEMINI_API_KEY が設定されていません' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  try {
    const body = await req.json()
    const { messages = [], system, json = false, max_tokens } = body

    // Claude形式のmessages → Gemini形式のcontentsに変換
    const contents = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: typeof m.content === 'string' ? m.content : (m.content?.[0]?.text || '') }],
    }))

    // 出力トークン上限：JSON生成タスク（メール返信・議事録）は長くなるので多めに確保
    const maxOutputTokens = max_tokens || (json ? 8000 : 4000)

    const generationConfig = {
      maxOutputTokens,
      // Gemini 2.5系は内部の「思考(thinking)」にもトークンを消費するため、
      // 全モードで思考を無効化し、予算をすべて出力に回す
      thinkingConfig: { thinkingBudget: 0 },
    }
    if (json) {
      generationConfig.responseMimeType = 'application/json'
    }

    const geminiBody = { contents, generationConfig }
    if (system) {
      geminiBody.systemInstruction = { parts: [{ text: system }] }
    }

    const model = 'gemini-2.5-flash'
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiBody),
    })

    const data = await response.json()

    // ---- エラー処理 ----
    if (!response.ok || data.error) {
      const err = data.error || {}
      // 429（quota超過）は「1分単位」か「1日単位」かを判別する
      if (response.status === 429 || err.code === 429 || err.status === 'RESOURCE_EXHAUSTED') {
        const info = analyzeQuota(err)
        return new Response(
          JSON.stringify({ error: info.message }),
          { status: 429, headers: { 'Content-Type': 'application/json' } }
        )
      }
      return new Response(
        JSON.stringify({ error: err.message || 'Gemini APIエラーが発生しました' }),
        { status: response.status || 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // ---- 正常応答 ----
    const candidate = data.candidates?.[0]
    const finishReason = candidate?.finishReason
    const text = candidate?.content?.parts?.map((p) => p.text).join('') || ''

    // 出力途中切れ（トークン上限到達）を検知
    if (finishReason === 'MAX_TOKENS' && !text.trim()) {
      return new Response(
        JSON.stringify({ error: '応答が長すぎて途中で切れました。入力内容を短くするか、もう一度お試しください。' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Claude形式に揃えて返す（App.jsxはdata.content[0].textを読む）
    return new Response(
      JSON.stringify({
        content: [{ type: 'text', text }],
        finishReason,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e.message || 'サーバーエラーが発生しました' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

// Googleの429エラー詳細から、日次/分単位の判別と待機秒数を取り出す
function analyzeQuota(err) {
  const details = err.details || []
  let isDaily = false
  let isMinute = false
  let retrySeconds = null
  const rawIds = []

  for (const d of details) {
    const type = d['@type'] || ''
    if (type.includes('QuotaFailure')) {
      for (const v of d.violations || []) {
        const id = `${v.quotaId || ''} ${v.quotaMetric || ''} ${v.quotaDimensions ? JSON.stringify(v.quotaDimensions) : ''}`
        rawIds.push(`${v.quotaId || v.quotaMetric || '?'}=上限${v.quotaValue || '?'}`)
        if (/PerDay|per_day|FreeTierRequests|free_tier_requests/i.test(id)) isDaily = true
        if (/PerMinute|per_minute/i.test(id)) isMinute = true
      }
    }
    if (type.includes('RetryInfo') && d.retryDelay) {
      const m = String(d.retryDelay).match(/([\d.]+)s/)
      if (m) retrySeconds = Math.ceil(parseFloat(m[1]))
    }
  }

  // 診断用：Geminiが返した生のメッセージと制限内容を末尾に付ける
  const diag = `［詳細: ${err.message || ''}${rawIds.length ? ' / ' + rawIds.join(', ') : ''}${retrySeconds ? ' / retry ' + retrySeconds + 's' : ''}］`

  // retryDelayが90秒超なら実質的に日次上限とみなす
  if (retrySeconds && retrySeconds > 90) isDaily = true

  if (isDaily && !isMinute) {
    return {
      message:
        '無料プランの【1日あたり】の利用上限に達しました。上限は太平洋時間の0時（日本時間の夕方〜夜頃）にリセットされます。' + diag,
    }
  }
  if (isMinute || (retrySeconds && retrySeconds <= 90)) {
    const wait = retrySeconds ? `約${retrySeconds}秒` : '1分ほど'
    return {
      message: `【1分あたり】の利用上限に達しました。${wait}待ってから再試行してください。` + diag,
    }
  }
  // 判別できない場合（ここに来る場合は制限の種類が不明 → 詳細を表示して原因を特定する）
  return {
    message: '利用上限（429）に達しましたが、種類を判別できませんでした。' + diag,
  }
}
