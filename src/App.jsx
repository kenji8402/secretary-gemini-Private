import { useState, useRef, useEffect } from "react";

const SYSTEM_PROMPT = `あなたは優秀なAI秘書です。ユーザーの仕事を効率的にサポートします。

あなたの役割：
- メールや文書の下書き作成
- 情報収集・要約
- アイデアのブレインストーミング
- ビジネス上の質問への回答

常に丁寧かつ的確に、プロフェッショナルな秘書として振る舞ってください。
返答は簡潔にまとめ、必要に応じてリストや構造化された形式を使ってください。
日本語で回答してください。`;

const EMAIL_REPLY_PROMPT = `あなたは優秀なビジネスメール秘書です。受信メールを分析し、返信案を作成します。
以下の形式でJSONのみを返してください（他のテキストは一切含めないこと）：
{"summary":"メールの要約（2〜3文）","intent":"メールの意図・目的","tone":"フォーマル / セミフォーマル / カジュアル","urgency":"高 / 中 / 低","keyPoints":["対応すべきポイント1","ポイント2"],"replies":[{"label":"承諾・前向きな返信","subject":"件名","body":"本文"},{"label":"保留・確認が必要な返信","subject":"件名","body":"本文"},{"label":"丁寧にお断りする返信","subject":"件名","body":"本文"}]}`;

// LM Studio（小型ローカルモデル）向けの軽量版プロンプト：返信は1案・分析も最小限にして出力を短くし、途中切れを防ぐ
const EMAIL_REPLY_PROMPT_SIMPLE = `あなたは優秀なビジネスメール秘書です。受信メールを分析し、返信案を1つだけ作成します。
以下の形式でJSONのみを返してください（他のテキストは一切含めないこと。短く簡潔に）：
{"summary":"メールの要約（1〜2文）","tone":"フォーマル / セミフォーマル / カジュアル","urgency":"高 / 中 / 低","replies":[{"label":"返信案","subject":"件名","body":"本文"}]}`;

const TONE_OPTIONS = [
  { key: "formal", label: "フォーマル", icon: "🎩", desc: "丁寧語・敬語を徹底した正式な文体", instruction: "非常にフォーマルで格式高い敬語を使い、結びの挨拶も含めた正式なビジネス文書の形式で書いてください。" },
  { key: "semiformal", label: "セミフォーマル", icon: "💼", desc: "丁寧だが親しみやすいビジネス文体", instruction: "丁寧語を基本としつつ、堅すぎない親しみやすいビジネス文体で書いてください。" },
  { key: "friendly", label: "親しみやすい", icon: "😊", desc: "柔らかく温かみのある文体", instruction: "丁寧さを保ちながら、柔らかく温かみのある親しみやすい文体で書いてください。絵文字は使わないでください。" },
  { key: "concise", label: "簡潔", icon: "⚡", desc: "要点のみ、短く端的な文体", instruction: "余計な前置きを省き、要点のみを短く端的にまとめた文体で書いてください。" },
  { key: "casual", label: "カジュアル", icon: "✌️", desc: "気軽な口調（社内向けなど）", instruction: "社内のチャットのような、丁寧語を保ちつつも気軽でカジュアルな文体で書いてください。" },
];
const DEFAULT_TONE = "semiformal";

const MINUTES_PROMPT = `あなたは優秀な議事録作成秘書です。会議の文字起こしから正式な議事録を作成します。
以下の形式でJSONのみを返してください（他のテキストは一切含めないこと）：
{"title":"会議タイトル","date":"会議日時（不明なら「不明」）","attendees":["参加者1"],"agenda":["議題1"],"summary":"会議全体の要約（3〜5文）","decisions":["決定事項1"],"actions":[{"task":"アクションアイテム","owner":"担当者（不明なら空）","due":"期日（不明なら空）"}],"nextMeeting":"次回会議（言及があれば）","fullMinutes":"正式な議事録本文（マークダウン形式）"}`;

const QUICK_ACTIONS = [
  { icon: "📧", label: "メール作成", prompt: "ビジネスメールの下書きを作成するのを手伝ってください。" },
  { icon: "💡", label: "アイデア出し", prompt: "ブレインストーミングを手伝ってください。テーマを教えます。" },
  { icon: "📊", label: "要約・分析", prompt: "テキストや情報を要約・分析するのを手伝ってください。" },
];

// PCの接続先の設定（このアプリ内トグルと連動）。サーバーがこの値で LM Studio / Gemini を振り分ける。
// ※スマホからのアクセスはサーバー側で常にGeminiになります（この設定はPC用）。
const BACKEND_KEY = "ai_sec_backend";
function getBackend() {
  try { return localStorage.getItem(BACKEND_KEY) || "lmstudio"; } catch { return "lmstudio"; }
}

// APIキーはサーバー側で管理 — フロントには露出しない
async function callClaude(payload) {
  const res = await fetch("/api/gemini", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, backend: getBackend() }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = (err && err.error && err.error.message) || (err && err.error) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return res.json();
}

function TypingIndicator() {
  return (
    <div style={{ display: "flex", gap: 5, alignItems: "center", padding: "12px 16px" }}>
      {[0,1,2].map(i => <div key={i} style={{ width: 8, height: 8, borderRadius: "50%", background: "#6C9FFF", animation: `pulse 1.2s ease-in-out ${i*0.2}s infinite` }} />)}
    </div>
  );
}

function Message({ msg }) {
  const isUser = msg.role === "user";
  return (
    <div style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start", marginBottom: 16, gap: 10, alignItems: "flex-start" }}>
      {!isUser && <div style={{ width: 32, height: 32, borderRadius: "50%", flexShrink: 0, background: "linear-gradient(135deg, #6C9FFF, #A78BFA)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, boxShadow: "0 0 10px rgba(108,159,255,0.4)" }}>🤖</div>}
      <div style={{ maxWidth: "75%", padding: "11px 15px", borderRadius: isUser ? "18px 18px 4px 18px" : "18px 18px 18px 4px", background: isUser ? "linear-gradient(135deg, #6C9FFF, #818CF8)" : "#1E2740", color: isUser ? "#fff" : "#B8C7FF", fontSize: 14, lineHeight: 1.7, whiteSpace: "pre-wrap", boxShadow: isUser ? "0 4px 15px rgba(108,159,255,0.3)" : "0 2px 8px rgba(0,0,0,0.3)" }}>
        {msg.content}
      </div>
      {isUser && <div style={{ width: 32, height: 32, borderRadius: "50%", flexShrink: 0, background: "#2A3555", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>👤</div>}
    </div>
  );
}

function EmailReplyView() {
  const [step, setStep] = useState("input");
  const [sender, setSender] = useState(""); const [subject, setSubject] = useState(""); const [body, setBody] = useState(""); const [customNote, setCustomNote] = useState("");
  const [result, setResult] = useState(null); const [error, setError] = useState(""); const [selectedReply, setSelectedReply] = useState(0); const [copied, setCopied] = useState(false);
  const [replyTone, setReplyTone] = useState(() => localStorage.getItem("ai_sec_reply_tone") || DEFAULT_TONE);

  function selectTone(key) {
    setReplyTone(key);
    localStorage.setItem("ai_sec_reply_tone", key);
  }

  const currentTone = TONE_OPTIONS.find(t => t.key === replyTone) || TONE_OPTIONS[1];

  async function analyze() {
    if (!body.trim()) return;
    setStep("loading"); setError("");
    try {
      const emailText = [sender ? `差出人: ${sender}` : "", subject ? `件名: ${subject}` : "", `\n本文:\n${body}`].filter(Boolean).join("\n");
      const toneInstruction = `\n\n返信文の文体について: ${currentTone.instruction}`;
      // LM Studio（小型モデル）のときは軽量版プロンプト（返信1案）で途中切れを防ぐ。Geminiは従来通り3案。
      const promptBase = getBackend() === "lmstudio" ? EMAIL_REPLY_PROMPT_SIMPLE : EMAIL_REPLY_PROMPT;
      const data = await callClaude({ system: promptBase + toneInstruction, json: true, messages: [{ role: "user", content: `以下のメールに対して返信案を作成してください。\n\n${emailText}${customNote ? `\n\n補足: ${customNote}` : ""}` }] });
      const parsed = JSON.parse((data.content?.[0]?.text || "").replace(/```json|```/g, "").trim());
      setResult(parsed); setSelectedReply(0); setStep("result");
    } catch (e) {
      const isJsonError = e.message.includes("JSON");
      setError(isJsonError
        ? "応答が途中で切れてしまい、解析できませんでした。もう一度お試しください。"
        : "解析に失敗しました：" + e.message);
      setStep("input");
    }
  }

  function copy(text) { navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }
  const urgencyColor = { 高: "#FF6B6B", 中: "#FFD93D", 低: "#6BCB77" };
  const toneColor = { フォーマル: "#6C9FFF", セミフォーマル: "#A78BFA", カジュアル: "#4ADE80" };

  if (step === "loading") return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20, padding: 24 }}>
      <div style={{ width: 56, height: 56, borderRadius: "50%", background: "linear-gradient(135deg, #6C9FFF, #A78BFA)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, animation: "glow 2s ease-in-out infinite" }}>🤖</div>
      <div style={{ textAlign: "center" }}><div style={{ fontSize: 15, fontWeight: 600, color: "#E8EDFF", marginBottom: 6 }}>メールを解析中...</div><div style={{ fontSize: 13, color: "#4A5580" }}>最適な返信案を生成しています</div></div>
      <div style={{ display: "flex", gap: 6 }}>{[0,1,2].map(i => <div key={i} style={{ width: 10, height: 10, borderRadius: "50%", background: "#6C9FFF", animation: `pulse 1.2s ease-in-out ${i*0.2}s infinite` }} />)}</div>
    </div>
  );

  if (step === "result" && result) {
    const reply = result.replies?.[selectedReply];
    return (
      <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <span style={{ fontSize: 11, color: "#4A5580" }}>生成トーン：<span style={{ color: "#6C9FFF", fontWeight: 600 }}>{currentTone.icon} {currentTone.label}</span></span>
        </div>
        <div style={{ background: "#1E2740", borderRadius: 14, padding: 14, marginBottom: 14, border: "1px solid #2A3555" }}>
          <div style={{ fontSize: 11, color: "#4A5580", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8 }}>📊 メール分析結果</div>
          <div style={{ fontSize: 13, color: "#B8C7FF", lineHeight: 1.7, marginBottom: 10 }}>{result.summary}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            {result.urgency && <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: `${urgencyColor[result.urgency]}22`, color: urgencyColor[result.urgency], border: `1px solid ${urgencyColor[result.urgency]}44` }}>緊急度: {result.urgency}</span>}
            {result.tone && <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: `${toneColor[result.tone]||"#6C9FFF"}22`, color: toneColor[result.tone]||"#6C9FFF", border: `1px solid ${toneColor[result.tone]||"#6C9FFF"}44` }}>トーン: {result.tone}</span>}
          </div>
          {result.keyPoints?.length > 0 && <div>{result.keyPoints.map((p,i) => <div key={i} style={{ display: "flex", gap: 8, fontSize: 13, color: "#B8C7FF", marginBottom: 3 }}><span style={{ color: "#6C9FFF" }}>•</span>{p}</div>)}</div>}
        </div>
        <div style={{ fontSize: 11, color: "#4A5580", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8 }}>✉️ 返信パターン</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
          {result.replies?.map((r,i) => <button key={i} onClick={() => setSelectedReply(i)} style={{ padding: "9px 14px", borderRadius: 10, border: "1px solid", borderColor: selectedReply===i ? "#6C9FFF" : "#2A3555", background: selectedReply===i ? "rgba(108,159,255,0.12)" : "#1E2740", color: selectedReply===i ? "#6C9FFF" : "#B8C7FF", cursor: "pointer", textAlign: "left", fontSize: 13, fontWeight: 600, transition: "all 0.2s" }}>{["✅","⏳","🙏"][i] || "✉️"} {r.label}</button>)}
        </div>
        {reply && (
          <div style={{ background: "#1E2740", borderRadius: 14, border: "1px solid #2A3555", overflow: "hidden", marginBottom: 14 }}>
            <div style={{ padding: "11px 14px", borderBottom: "1px solid #2A3555", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div><div style={{ fontSize: 11, color: "#4A5580", marginBottom: 3 }}>件名</div><div style={{ fontSize: 13, color: "#E8EDFF", fontWeight: 600 }}>{reply.subject}</div></div>
              <button onClick={() => copy(`件名: ${reply.subject}\n\n${reply.body}`)} style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid #2A3555", background: copied ? "rgba(74,222,128,0.15)" : "transparent", color: copied ? "#4ADE80" : "#6C9FFF", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>{copied ? "✓ コピー済" : "📋 コピー"}</button>
            </div>
            <div style={{ padding: 14 }}><div style={{ fontSize: 11, color: "#4A5580", marginBottom: 6 }}>本文</div><div style={{ fontSize: 13, color: "#B8C7FF", lineHeight: 1.9, whiteSpace: "pre-wrap" }}>{reply.body}</div></div>
          </div>
        )}
        <button onClick={() => { setStep("input"); setResult(null); }} style={{ width: "100%", padding: 11, borderRadius: 10, border: "1px solid #2A3555", background: "transparent", color: "#4A5580", cursor: "pointer", fontSize: 13 }} onMouseEnter={e => { e.currentTarget.style.borderColor="#6C9FFF"; e.currentTarget.style.color="#6C9FFF"; }} onMouseLeave={e => { e.currentTarget.style.borderColor="#2A3555"; e.currentTarget.style.color="#4A5580"; }}>← 別のメールを解析する</button>
        <button onClick={analyze} style={{ width: "100%", padding: 9, borderRadius: 10, border: "none", background: "transparent", color: "#6C9FFF", cursor: "pointer", fontSize: 12, marginTop: 6 }}>🔄 同じメールを{currentTone.icon} {currentTone.label}トーンで再生成</button>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
      <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div><div style={{ fontSize: 16, fontWeight: 700, color: "#E8EDFF", marginBottom: 3 }}>📨 メール返信アシスタント</div><div style={{ fontSize: 12, color: "#4A5580" }}>受信メールを貼り付けると返信案を自動生成します</div></div>
      </div>

      {/* トーン設定 */}
      <div style={{ background: "#1E2740", borderRadius: 12, padding: 14, marginBottom: 14, border: "1px solid #2A3555" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <span style={{ fontSize: 11, color: "#4A5580", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8 }}>🎙️ 返信のトーン</span>
          <span style={{ fontSize: 11, color: "#6C9FFF" }}>{currentTone.icon} {currentTone.label}</span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {TONE_OPTIONS.map(t => (
            <button key={t.key} onClick={() => selectTone(t.key)} title={t.desc} style={{
              display: "flex", alignItems: "center", gap: 5, padding: "6px 11px", borderRadius: 16, border: "1px solid",
              borderColor: replyTone === t.key ? "#6C9FFF" : "#2A3555",
              background: replyTone === t.key ? "rgba(108,159,255,0.15)" : "transparent",
              color: replyTone === t.key ? "#6C9FFF" : "#B8C7FF", cursor: "pointer", fontSize: 12, fontWeight: 600, transition: "all 0.15s"
            }}>
              <span>{t.icon}</span>{t.label}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 11, color: "#4A5580", marginTop: 8 }}>{currentTone.desc} · 次回以降も自動で適用されます</div>
      </div>

      {error && <div style={{ background: "rgba(255,107,107,0.1)", border: "1px solid rgba(255,107,107,0.3)", borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 13, color: "#FF6B6B" }}>{error}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div><label style={{ fontSize: 11, color: "#4A5580", fontWeight: 600, display: "block", marginBottom: 5 }}>差出人（任意）</label><input value={sender} onChange={e => setSender(e.target.value)} placeholder="例: 田中 太郎" style={{ width: "100%", background: "#1E2740", border: "1px solid #2A3555", borderRadius: 10, padding: "9px 13px", color: "#E8EDFF", fontSize: 13, outline: "none", fontFamily: "inherit" }} /></div>
        <div><label style={{ fontSize: 11, color: "#4A5580", fontWeight: 600, display: "block", marginBottom: 5 }}>件名（任意）</label><input value={subject} onChange={e => setSubject(e.target.value)} placeholder="例: 来週の打ち合わせについて" style={{ width: "100%", background: "#1E2740", border: "1px solid #2A3555", borderRadius: 10, padding: "9px 13px", color: "#E8EDFF", fontSize: 13, outline: "none", fontFamily: "inherit" }} /></div>
        <div><label style={{ fontSize: 11, color: "#4A5580", fontWeight: 600, display: "block", marginBottom: 5 }}>メール本文 <span style={{ color: "#FF6B6B" }}>*</span></label><textarea value={body} onChange={e => setBody(e.target.value)} placeholder="受信したメールの本文をここに貼り付けてください..." rows={7} style={{ width: "100%", background: "#1E2740", border: "1px solid #2A3555", borderRadius: 10, padding: "11px 13px", color: "#E8EDFF", fontSize: 13, outline: "none", fontFamily: "inherit", resize: "vertical", lineHeight: 1.7 }} /></div>
        <div><label style={{ fontSize: 11, color: "#4A5580", fontWeight: 600, display: "block", marginBottom: 5 }}>補足・返信の方向性（任意）</label><input value={customNote} onChange={e => setCustomNote(e.target.value)} placeholder="例: 来週は都合が悪い" style={{ width: "100%", background: "#1E2740", border: "1px solid #2A3555", borderRadius: 10, padding: "9px 13px", color: "#E8EDFF", fontSize: 13, outline: "none", fontFamily: "inherit" }} /></div>
        <button onClick={analyze} disabled={!body.trim()} style={{ padding: "12px", borderRadius: 12, border: "none", background: body.trim() ? "linear-gradient(135deg, #6C9FFF, #818CF8)" : "#2A3555", color: "#fff", cursor: body.trim() ? "pointer" : "default", fontSize: 14, fontWeight: 700, boxShadow: body.trim() ? "0 4px 20px rgba(108,159,255,0.4)" : "none" }}>🤖 返信案を生成する</button>
      </div>
    </div>
  );
}

function MinutesView() {
  const [step, setStep] = useState("input");
  const [transcript, setTranscript] = useState(""); const [meta, setMeta] = useState("");
  const [result, setResult] = useState(null); const [error, setError] = useState(""); const [tab, setTab] = useState("overview"); const [copied, setCopied] = useState(false);

  async function generate() {
    if (!transcript.trim()) return;
    setStep("loading"); setError("");
    try {
      const data = await callClaude({ system: MINUTES_PROMPT, json: true, messages: [{ role: "user", content: `以下の会議の文字起こしから議事録を作成してください。\n\n${meta ? `補足情報: ${meta}\n\n` : ""}文字起こし:\n${transcript}` }] });
      const parsed = JSON.parse((data.content?.[0]?.text || "").replace(/```json|```/g, "").trim());
      setResult(parsed); setTab("overview"); setStep("result");
    } catch (e) {
      const isJsonError = e.message.includes("JSON");
      setError(isJsonError
        ? "応答が途中で切れてしまい、議事録を解析できませんでした。文字起こしを短く分割するか、もう一度お試しください。"
        : "議事録の生成に失敗しました：" + e.message);
      setStep("input");
    }
  }

  function copyFull() { navigator.clipboard.writeText(result?.fullMinutes || "").then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }

  if (step === "loading") return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20, padding: 24 }}>
      <div style={{ width: 56, height: 56, borderRadius: "50%", background: "linear-gradient(135deg, #6C9FFF, #A78BFA)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, animation: "glow 2s ease-in-out infinite" }}>📝</div>
      <div style={{ textAlign: "center" }}><div style={{ fontSize: 15, fontWeight: 600, color: "#E8EDFF", marginBottom: 6 }}>文字起こしを解析中...</div><div style={{ fontSize: 13, color: "#4A5580" }}>議事録を整理しています</div></div>
      <div style={{ display: "flex", gap: 6 }}>{[0,1,2].map(i => <div key={i} style={{ width: 10, height: 10, borderRadius: "50%", background: "#6C9FFF", animation: `pulse 1.2s ease-in-out ${i*0.2}s infinite` }} />)}</div>
    </div>
  );

  if (step === "result" && result) return (
    <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
      <div style={{ marginBottom: 14 }}><div style={{ fontSize: 15, fontWeight: 700, color: "#E8EDFF", marginBottom: 2 }}>{result.title}</div><div style={{ fontSize: 12, color: "#4A5580" }}>{result.date !== "不明" ? result.date : ""}{result.attendees?.length ? ` · 参加者 ${result.attendees.length}名` : ""}</div></div>
      <div style={{ display: "flex", gap: 6, marginBottom: 14, background: "#1E2740", borderRadius: 10, padding: 4 }}>
        {[["overview","概要"],["actions","アクション"],["full","議事録全文"]].map(([k,l]) => <button key={k} onClick={() => setTab(k)} style={{ flex: 1, padding: "7px 0", borderRadius: 8, border: "none", background: tab===k ? "rgba(108,159,255,0.2)" : "transparent", color: tab===k ? "#6C9FFF" : "#4A5580", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>{l}</button>)}
      </div>
      {tab === "overview" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ background: "#1E2740", borderRadius: 12, padding: 14, border: "1px solid #2A3555" }}><div style={{ fontSize: 11, color: "#4A5580", fontWeight: 700, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.8 }}>📋 会議の要約</div><div style={{ fontSize: 13, color: "#B8C7FF", lineHeight: 1.8 }}>{result.summary}</div></div>
          {result.attendees?.length > 0 && <div style={{ background: "#1E2740", borderRadius: 12, padding: 14, border: "1px solid #2A3555" }}><div style={{ fontSize: 11, color: "#4A5580", fontWeight: 700, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.8 }}>👥 参加者</div><div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{result.attendees.map((a,i) => <span key={i} style={{ padding: "3px 10px", borderRadius: 20, background: "rgba(108,159,255,0.1)", border: "1px solid rgba(108,159,255,0.2)", color: "#6C9FFF", fontSize: 12 }}>{a}</span>)}</div></div>}
          {result.decisions?.length > 0 && <div style={{ background: "#1E2740", borderRadius: 12, padding: 14, border: "1px solid #2A3555" }}><div style={{ fontSize: 11, color: "#4A5580", fontWeight: 700, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.8 }}>✅ 決定事項</div>{result.decisions.map((d,i) => <div key={i} style={{ display: "flex", gap: 8, fontSize: 13, color: "#B8C7FF", marginBottom: 6 }}><span style={{ color: "#4ADE80", flexShrink: 0 }}>✓</span>{d}</div>)}</div>}
          {result.agenda?.length > 0 && <div style={{ background: "#1E2740", borderRadius: 12, padding: 14, border: "1px solid #2A3555" }}><div style={{ fontSize: 11, color: "#4A5580", fontWeight: 700, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.8 }}>📌 議題</div>{result.agenda.map((a,i) => <div key={i} style={{ display: "flex", gap: 8, fontSize: 13, color: "#B8C7FF", marginBottom: 4 }}><span style={{ color: "#6C9FFF" }}>{i+1}.</span>{a}</div>)}</div>}
        </div>
      )}
      {tab === "actions" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {result.actions?.length > 0 ? result.actions.map((a,i) => <div key={i} style={{ background: "#1E2740", borderRadius: 12, padding: 14, border: "1px solid #2A3555" }}><div style={{ fontSize: 13, color: "#E8EDFF", fontWeight: 600, marginBottom: 6 }}>{a.task}</div><div style={{ display: "flex", gap: 12 }}>{a.owner && <span style={{ fontSize: 11, color: "#6C9FFF" }}>👤 {a.owner}</span>}{a.due && <span style={{ fontSize: 11, color: "#FFD93D" }}>📅 {a.due}</span>}</div></div>) : <div style={{ textAlign: "center", padding: 40, color: "#4A5580", fontSize: 13 }}>アクションアイテムは見つかりませんでした</div>}
        </div>
      )}
      {tab === "full" && (
        <div style={{ background: "#1E2740", borderRadius: 12, border: "1px solid #2A3555", overflow: "hidden" }}>
          <div style={{ padding: "11px 14px", borderBottom: "1px solid #2A3555", display: "flex", justifyContent: "flex-end" }}><button onClick={copyFull} style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid #2A3555", background: copied ? "rgba(74,222,128,0.15)" : "transparent", color: copied ? "#4ADE80" : "#6C9FFF", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>{copied ? "✓ コピー済" : "📋 全文コピー"}</button></div>
          <div style={{ padding: 16, fontSize: 13, color: "#B8C7FF", lineHeight: 1.9, whiteSpace: "pre-wrap" }}>{result.fullMinutes}</div>
        </div>
      )}
      <button onClick={() => { setStep("input"); setResult(null); setTranscript(""); setMeta(""); }} style={{ width: "100%", padding: 11, borderRadius: 10, border: "1px solid #2A3555", background: "transparent", color: "#4A5580", cursor: "pointer", fontSize: 13, marginTop: 14 }} onMouseEnter={e => { e.currentTarget.style.borderColor="#6C9FFF"; e.currentTarget.style.color="#6C9FFF"; }} onMouseLeave={e => { e.currentTarget.style.borderColor="#2A3555"; e.currentTarget.style.color="#4A5580"; }}>← 別の文字起こしを解析する</button>
    </div>
  );

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
      <div style={{ marginBottom: 16 }}><div style={{ fontSize: 16, fontWeight: 700, color: "#E8EDFF", marginBottom: 3 }}>📝 議事録アシスタント</div><div style={{ fontSize: 12, color: "#4A5580" }}>会議の文字起こしを貼り付けると議事録を自動生成します</div></div>
      {error && <div style={{ background: "rgba(255,107,107,0.1)", border: "1px solid rgba(255,107,107,0.3)", borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 13, color: "#FF6B6B" }}>{error}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div><label style={{ fontSize: 11, color: "#4A5580", fontWeight: 600, display: "block", marginBottom: 5 }}>補足情報（任意）</label><input value={meta} onChange={e => setMeta(e.target.value)} placeholder="例: 2024年6月16日 / プロジェクト定例会" style={{ width: "100%", background: "#1E2740", border: "1px solid #2A3555", borderRadius: 10, padding: "9px 13px", color: "#E8EDFF", fontSize: 13, outline: "none", fontFamily: "inherit" }} /></div>
        <div><label style={{ fontSize: 11, color: "#4A5580", fontWeight: 600, display: "block", marginBottom: 5 }}>文字起こし <span style={{ color: "#FF6B6B" }}>*</span></label><textarea value={transcript} onChange={e => setTranscript(e.target.value)} placeholder={"会議の文字起こしをここに貼り付けてください..."} rows={10} style={{ width: "100%", background: "#1E2740", border: "1px solid #2A3555", borderRadius: 10, padding: "11px 13px", color: "#E8EDFF", fontSize: 13, outline: "none", fontFamily: "inherit", resize: "vertical", lineHeight: 1.7 }} /></div>
        <button onClick={generate} disabled={!transcript.trim()} style={{ padding: "12px", borderRadius: 12, border: "none", background: transcript.trim() ? "linear-gradient(135deg, #6C9FFF, #818CF8)" : "#2A3555", color: "#fff", cursor: transcript.trim() ? "pointer" : "default", fontSize: 14, fontWeight: 700, boxShadow: transcript.trim() ? "0 4px 20px rgba(108,159,255,0.4)" : "none" }}>🤖 議事録を生成する</button>
      </div>
    </div>
  );
}

export default function AISecretary() {
  const [messages, setMessages] = useState([{ role: "assistant", content: "こんにちは！私はあなたのAI秘書です。\n\nメール作成、アイデア出し、情報の要約・分析など、お仕事のサポートをお任せください。今日は何からお手伝いしましょうか？" }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState("chat");
  const [backend, setBackend] = useState(() => getBackend());
  const [tasks, setTasks] = useState([
    { id: 1, text: "Q3レポートの確認", done: false, priority: "high" },
    { id: 2, text: "チームミーティングの準備", done: false, priority: "medium" },
    { id: 3, text: "クライアントへの返信", done: true, priority: "high" },
  ]);
  const [newTask, setNewTask] = useState("");
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  function toggleBackend() {
    const next = backend === "lmstudio" ? "gemini" : "lmstudio";
    setBackend(next);
    try { localStorage.setItem(BACKEND_KEY, next); } catch {}
  }

  async function sendMessage(text) {
    if (!text.trim() || loading) return;
    const userMsg = { role: "user", content: text };
    const updated = [...messages, userMsg];
    setMessages(updated); setInput(""); setLoading(true);
    try {
      const data = await callClaude({ system: SYSTEM_PROMPT, messages: updated.map(m => ({ role: m.role, content: m.content })) });
      setMessages(prev => [...prev, { role: "assistant", content: data.content?.[0]?.text || "エラーが発生しました。" }]);
    } catch (e) {
      setMessages(prev => [...prev, { role: "assistant", content: `エラー: ${e.message}` }]);
    } finally { setLoading(false); }
  }

  function handleKey(e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }
  const priorityColor = { high: "#FF6B6B", medium: "#FFD93D", low: "#6BCB77" };
  const NAV = [{ key: "chat", icon: "💬", label: "チャット" }, { key: "email", icon: "📨", label: "返信作成" }, { key: "minutes", icon: "📝", label: "議事録" }, { key: "tasks", icon: "✅", label: "タスク" }];

  const isLM = backend === "lmstudio";

  return (
    <div style={{ height: "100dvh", background: "#0A0E1A", color: "#B8C7FF", fontFamily: "'Inter', system-ui, sans-serif", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:.3;transform:scale(.8)} 50%{opacity:1;transform:scale(1)} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes glow { 0%,100%{box-shadow:0 0 16px rgba(108,159,255,0.4)} 50%{box-shadow:0 0 32px rgba(108,159,255,0.8)} }
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: transparent; } ::-webkit-scrollbar-thumb { background: #2A3555; border-radius: 4px; }
        textarea { resize: none; } textarea::placeholder { color: #4A5580; } input::placeholder { color: #4A5580; }
        button { -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
      `}</style>

      <div style={{ background: "rgba(30,39,64,0.95)", backdropFilter: "blur(12px)", borderBottom: "1px solid #1E2740", flexShrink: 0 }}>
        <div style={{ padding: "8px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: "linear-gradient(135deg, #6C9FFF, #A78BFA)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, boxShadow: "0 0 10px rgba(108,159,255,0.4)" }}>🤖</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#E8EDFF" }}>AI秘書</span>
              <button onClick={toggleBackend} title="PCの接続先を切り替え（スマホは常にGemini）" style={{
                display: "flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 12,
                border: "1px solid", borderColor: isLM ? "rgba(108,159,255,0.5)" : "rgba(167,139,250,0.5)",
                background: isLM ? "rgba(108,159,255,0.12)" : "rgba(167,139,250,0.12)",
                color: isLM ? "#6C9FFF" : "#A78BFA", cursor: "pointer", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap"
              }}>
                <span>{isLM ? "🖥" : "☁"}</span>{isLM ? "LM Studio" : "Gemini"}<span style={{ opacity: 0.6, fontWeight: 400 }}>切替</span>
              </button>
            </div>
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            {NAV.map(({ key, icon, label }) => (
              <button key={key} onClick={() => setView(key)} style={{ padding: "5px 10px", borderRadius: 16, border: "1px solid", borderColor: view===key ? "#6C9FFF" : "transparent", background: view===key ? "rgba(108,159,255,0.15)" : "transparent", color: view===key ? "#6C9FFF" : "#4A5580", cursor: "pointer", fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center", gap: 3 }}>
                <span>{icon}</span><span>{label}</span>
              </button>
            ))}
          </div>
        </div>
        {view === "chat" && (
          <div style={{ padding: "0 16px 8px", display: "flex", gap: 6, borderTop: "1px solid #1a2238" }}>
            <span style={{ fontSize: 10, color: "#4A5580", alignSelf: "center", whiteSpace: "nowrap", marginRight: 2 }}>クイック：</span>
            {QUICK_ACTIONS.map(a => (
              <button key={a.label} onClick={() => sendMessage(a.prompt)} style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 14, border: "1px solid #2A3555", background: "transparent", color: "#B8C7FF", cursor: "pointer", fontSize: 12, fontWeight: 500, whiteSpace: "nowrap" }}>
                <span style={{ fontSize: 13 }}>{a.icon}</span>{a.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {view === "chat" && (
          <>
            <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", WebkitOverflowScrolling: "touch" }}>
              {messages.map((m,i) => <div key={i} style={{ animation: "fadeIn 0.3s ease" }}><Message msg={m} /></div>)}
              {loading && (
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 16 }}>
                  <div style={{ width: 32, height: 32, borderRadius: "50%", flexShrink: 0, background: "linear-gradient(135deg, #6C9FFF, #A78BFA)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>🤖</div>
                  <div style={{ background: "#1E2740", borderRadius: "18px 18px 18px 4px" }}><TypingIndicator /></div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
            <div style={{ padding: "12px 16px", background: "rgba(10,14,26,0.95)", borderTop: "1px solid #1E2740", flexShrink: 0 }}>
              <div style={{ display: "flex", gap: 8, background: "#1E2740", borderRadius: 14, padding: "7px 7px 7px 14px", border: "1px solid #2A3555" }}>
                <textarea ref={textareaRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKey} placeholder="メッセージを入力..." rows={1} style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "#E8EDFF", fontSize: 16, lineHeight: 1.6, fontFamily: "inherit", maxHeight: 100, overflowY: "auto" }} />
                <button onClick={() => sendMessage(input)} disabled={!input.trim() || loading} style={{ width: 34, height: 34, borderRadius: 10, border: "none", background: input.trim() && !loading ? "linear-gradient(135deg, #6C9FFF, #818CF8)" : "#2A3555", color: "#fff", cursor: input.trim() && !loading ? "pointer" : "default", fontSize: 14, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>➤</button>
              </div>
            </div>
          </>
        )}
        {view === "email" && <EmailReplyView />}
        {view === "minutes" && <MinutesView />}
        {view === "tasks" && (
          <div style={{ flex: 1, overflowY: "auto", padding: 20, WebkitOverflowScrolling: "touch" }}>
            <div style={{ marginBottom: 16 }}><div style={{ fontSize: 16, fontWeight: 700, color: "#E8EDFF", marginBottom: 3 }}>タスク管理</div><div style={{ fontSize: 12, color: "#4A5580" }}>{tasks.filter(t => !t.done).length}件のタスクが残っています</div></div>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <input value={newTask} onChange={e => setNewTask(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && newTask.trim()) { setTasks(prev => [...prev, { id: Date.now(), text: newTask.trim(), done: false, priority: "medium" }]); setNewTask(""); } }} placeholder="新しいタスクを追加..." style={{ flex: 1, background: "#1E2740", border: "1px solid #2A3555", borderRadius: 10, padding: "9px 13px", color: "#E8EDFF", fontSize: 16, outline: "none", fontFamily: "inherit" }} />
              <button onClick={() => { if (newTask.trim()) { setTasks(prev => [...prev, { id: Date.now(), text: newTask.trim(), done: false, priority: "medium" }]); setNewTask(""); } }} style={{ padding: "9px 16px", background: "linear-gradient(135deg, #6C9FFF, #818CF8)", border: "none", borderRadius: 10, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>追加</button>
            </div>
            {["high","medium","low"].map(priority => {
              const filtered = tasks.filter(t => t.priority === priority);
              if (!filtered.length) return null;
              const label = { high: "🔴 高優先度", medium: "🟡 中優先度", low: "🟢 低優先度" }[priority];
              return (
                <div key={priority} style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 11, color: "#4A5580", marginBottom: 6, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.8 }}>{label}</div>
                  {filtered.map(task => (
                    <div key={task.id} style={{ display: "flex", alignItems: "center", gap: 10, background: "#1E2740", borderRadius: 10, padding: "11px 13px", marginBottom: 5, border: "1px solid #2A3555", opacity: task.done ? 0.5 : 1 }}>
                      <div onClick={() => setTasks(prev => prev.map(t => t.id===task.id ? {...t, done: !t.done} : t))} style={{ width: 22, height: 22, borderRadius: 6, border: `2px solid ${priorityColor[priority]}`, cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: task.done ? priorityColor[priority] : "transparent" }}>
                        {task.done && <span style={{ color: "#fff", fontSize: 11, fontWeight: 700 }}>✓</span>}
                      </div>
                      <span style={{ flex: 1, fontSize: 14, textDecoration: task.done ? "line-through" : "none", color: task.done ? "#4A5580" : "#B8C7FF" }}>{task.text}</span>
                      <button onClick={() => setTasks(prev => prev.filter(t => t.id !== task.id))} style={{ background: "none", border: "none", color: "#4A5580", cursor: "pointer", fontSize: 20, padding: "0 4px" }}>×</button>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
