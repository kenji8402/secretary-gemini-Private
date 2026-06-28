import { useState, useRef, useEffect } from "react";

const APP_VERSION = "1.6 (2026-06-28)";

const SYSTEM_PROMPT = `あなたは優秀なAI秘書です。ユーザーの仕事を効率的にサポートします。

あなたの役割：
- メールや文書の下書き作成
- 情報収集・要約
- アイデアのブレインストーミング
- ビジネス上の質問への回答

常に丁寧かつ的確に、プロフェッショナルな秘書として振る舞ってください。
返答は簡潔にまとめ、必要に応じて見出しや箇条書きなど構造化された形式を使ってください。
日本語で回答してください。`;

const EMAIL_REPLY_PROMPT = `あなたは優秀なビジネスメール秘書です。受信メールを分析し、返信案を作成します。
以下の形式でJSONのみを返してください（他のテキストは一切含めないこと）：
{"summary":"メールの要約（2〜3文）","intent":"メールの意図・目的","tone":"フォーマル / セミフォーマル / カジュアル","urgency":"高 / 中 / 低","keyPoints":["対応すべきポイント1","ポイント2"],"replies":[{"label":"承諾・前向きな返信","subject":"件名","body":"本文"},{"label":"保留・確認が必要な返信","subject":"件名","body":"本文"},{"label":"丁寧にお断りする返信","subject":"件名","body":"本文"}]}`;

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

const FILE_ANALYSIS_PROMPT = `あなたは優秀な資料分析アシスタントです。ユーザーが添付した文書の内容を読み、わかりやすく解析します。
- まず文書全体の要点を簡潔にまとめる
- 重要なポイント・数値・日付・固有名詞を箇条書きで挙げる
- ユーザーから質問があれば、それに文書の内容を根拠として的確に答える
- 情報が不足している点や不明な点があれば正直に指摘する
日本語で、見出しや箇条書きを使って読みやすく構造化して回答してください。`;

const QUICK_ACTIONS = [
  { icon: "📧", label: "メール作成", prompt: "ビジネスメールの下書きを作成するのを手伝ってください。" },
  { icon: "💡", label: "アイデア出し", prompt: "ブレインストーミングを手伝ってください。テーマを教えます。" },
  { icon: "📊", label: "要約・分析", prompt: "テキストや情報を要約・分析するのを手伝ってください。" },
];

const BACKEND_KEY = "ai_sec_backend";
function getBackend() {
  try { return localStorage.getItem(BACKEND_KEY) || "lmstudio"; } catch { return "lmstudio"; }
}
function isMobileUA() {
  try { return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent); } catch { return false; }
}

// ===== Geminiの当日利用回数カウンタ（無料枠の目安表示用） =====
function todayStr() { return new Date().toISOString().slice(0, 10); }
function getGeminiCount() {
  try { const o = JSON.parse(localStorage.getItem("ai_sec_gcount") || "{}"); return o.date === todayStr() ? (o.count || 0) : 0; } catch { return 0; }
}
function bumpGeminiCount() {
  try { const c = getGeminiCount() + 1; localStorage.setItem("ai_sec_gcount", JSON.stringify({ date: todayStr(), count: c })); } catch {}
}

// APIキーはサーバー側で管理 — フロントには露出しない
async function callClaude(payload) {
  const backend = getBackend();
  if (backend === "gemini" || isMobileUA()) bumpGeminiCount();
  const res = await fetch("/api/gemini", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, backend }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = (err && err.error && err.error.message) || (err && err.error) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return res.json();
}

// ===== 軽量Markdownレンダラ（外部依存なし・安全にエスケープ） =====
const BT = String.fromCharCode(96);
function escapeHtml(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function mdInline(t) {
  const codeRe = new RegExp(BT + "([^" + BT + "]+?)" + BT, "g");
  return t
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(codeRe, "<code>$1</code>")
    .replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}
function renderMarkdown(md) {
  if (!md) return "";
  const fence = BT + BT + BT;
  const lines = escapeHtml(md).split("\n");
  let html = "", inUl = false, inOl = false, inCode = false;
  function closeLists() { if (inUl) { html += "</ul>"; inUl = false; } if (inOl) { html += "</ol>"; inOl = false; } }
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (line.indexOf(fence) === 0) { if (inCode) { html += "</pre>"; inCode = false; } else { closeLists(); html += "<pre>"; inCode = true; } continue; }
    if (inCode) { html += line + "\n"; continue; }
    let h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { closeLists(); const lvl = Math.min(h[1].length + 2, 6); html += "<h" + lvl + ">" + mdInline(h[2]) + "</h" + lvl + ">"; continue; }
    let ul = line.match(/^\s*[-*・]\s+(.*)$/);
    if (ul) { if (!inUl) { closeLists(); html += "<ul>"; inUl = true; } html += "<li>" + mdInline(ul[1]) + "</li>"; continue; }
    let ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ol) { if (!inOl) { closeLists(); html += "<ol>"; inOl = true; } html += "<li>" + mdInline(ol[1]) + "</li>"; continue; }
    if (line.trim() === "") { closeLists(); continue; }
    closeLists(); html += "<div>" + mdInline(line) + "</div>";
  }
  closeLists(); if (inCode) html += "</pre>";
  return html;
}
function Markdown({ text }) {
  return <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />;
}

// ===== 添付ファイルからテキストを抽出（クライアント側で完結） =====
function loadExternalScript(src) {
  return new Promise((resolve, reject) => {
    const existing = Array.from(document.scripts).find(s => s.src === src);
    if (existing) {
      if (existing.dataset.loaded === "1") return resolve();
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("ライブラリの読み込みに失敗しました")));
      return;
    }
    const el = document.createElement("script");
    el.src = src;
    el.onload = () => { el.dataset.loaded = "1"; resolve(); };
    el.onerror = () => reject(new Error("外部ライブラリの読み込みに失敗しました（ネット接続を確認してください）"));
    document.head.appendChild(el);
  });
}
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|log|xml|yml|yaml|html|htm|css|js|jsx|ts|tsx|py|java|c|cpp|cs|rb|go|rs|php|sh|sql)$/i;
const MAX_DOC_CHARS = 30000;
async function extractFileText(file) {
  const name = file.name.toLowerCase();
  if (TEXT_EXT.test(name)) return await file.text();
  if (name.endsWith(".pdf")) {
    await loadExternalScript("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js");
    const pdfjsLib = window.pdfjsLib;
    pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    const data = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    let out = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      out += tc.items.map(it => it.str).join(" ") + "\n\n";
    }
    return out;
  }
  if (name.endsWith(".docx")) {
    await loadExternalScript("https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js");
    const arrayBuffer = await file.arrayBuffer();
    const res = await window.mammoth.extractRawText({ arrayBuffer });
    return res.value;
  }
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    await loadExternalScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js");
    const data = await file.arrayBuffer();
    const wb = window.XLSX.read(data, { type: "array" });
    let out = "";
    wb.SheetNames.forEach(n => { out += "## シート: " + n + "\n" + window.XLSX.utils.sheet_to_csv(wb.Sheets[n]) + "\n\n"; });
    return out;
  }
  throw new Error("対応形式: txt / md / csv / json / pdf / docx / xlsx など。この形式は未対応です。");
}

// ===== 書き出し（ダウンロード／印刷）ヘルパー =====
function downloadFile(filename, content, mime) {
  try {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  } catch (e) {}
}
function safeName(s2) { return (s2 || "export").replace(/[\\/:*?"<>|]/g, "_").slice(0, 40); }
function downloadMarkdown(name, md) { downloadFile(safeName(name) + ".md", md || "", "text/markdown;charset=utf-8"); }
function downloadWord(name, title, md) {
  const html = "<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word'><head><meta charset='utf-8'><title>" + escapeHtml(title) + "</title></head><body>" + renderMarkdown(md) + "</body></html>";
  downloadFile(safeName(name) + ".doc", "﻿" + html, "application/msword");
}
function printAsPdf(title, md) {
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write("<html><head><meta charset='utf-8'><title>" + escapeHtml(title) + "</title><style>body{font-family:'Segoe UI','Meiryo',sans-serif;line-height:1.8;padding:28px;color:#111;max-width:760px;margin:auto}h3,h4,h5{margin:14px 0 4px}ul,ol{padding-left:22px}code{background:#eee;padding:1px 4px;border-radius:3px}pre{background:#f4f4f4;padding:10px;border-radius:6px;white-space:pre-wrap}</style></head><body>" + renderMarkdown(md) + "</body></html>");
  w.document.close(); w.focus(); setTimeout(() => { try { w.print(); } catch (e) {} }, 350);
}
function chatToMarkdown(msgs) { return "# AI秘書 チャット履歴\n\n" + msgs.map(m => (m.role === "user" ? "### 🧑 あなた\n" : "### 🤖 AI秘書\n") + m.content).join("\n\n"); }

function ExportBar({ name, title, markdown, noMarkdown }) {
  const btn = { padding: "5px 11px", borderRadius: 8, border: "1px solid #2A3555", background: "transparent", color: "#6C9FFF", cursor: "pointer", fontSize: 12, fontWeight: 600 };
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
      {!noMarkdown && <button style={btn} onClick={() => downloadMarkdown(name, markdown)}>⬇ Markdown</button>}
      <button style={btn} onClick={() => downloadWord(name, title, markdown)}>⬇ Word</button>
      <button style={btn} onClick={() => printAsPdf(title, markdown)}>🖨 PDF / 印刷</button>
    </div>
  );
}

const TRANSLATE_PROMPT = "あなたはプロの翻訳者です。入力されたテキストを指定言語へ自然で正確に翻訳します。原文の意味・トーン・敬体/常体を尊重し、訳文だけを返してください（解説や注釈は不要）。固有名詞や専門用語は適切に扱ってください。";

function TranslateView() {
  const LANGS = [["日本語", "日本語"], ["英語", "English"], ["中国語", "中文（簡体）"], ["韓国語", "한국어"], ["フランス語", "Français"], ["スペイン語", "Español"]];
  const [text, setText] = useState("");
  const [target, setTarget] = useState(() => { try { return localStorage.getItem("ai_sec_lang") || "英語"; } catch { return "英語"; } });
  const [result, setResult] = useState("");
  const [step, setStep] = useState("input");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  async function run() {
    if (!text.trim()) return;
    setStep("loading"); setError("");
    try {
      const data = await callClaude({ system: TRANSLATE_PROMPT, max_tokens: 4000, messages: [{ role: "user", content: "次のテキストを" + target + "に翻訳してください。\n\n" + text }] });
      setResult(data.content?.[0]?.text || "（応答が空でした）"); setStep("result");
    } catch (e) { setError("翻訳に失敗しました：" + e.message); setStep("input"); }
  }
  if (step === "loading") return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20, padding: 24 }}>
      <div style={{ width: 56, height: 56, borderRadius: "50%", background: "linear-gradient(135deg, #6C9FFF, #A78BFA)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, animation: "glow 2s ease-in-out infinite" }}>🌐</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: "#E8EDFF" }}>翻訳中...</div>
      <div style={{ display: "flex", gap: 6 }}>{[0,1,2].map(i => <div key={i} style={{ width: 10, height: 10, borderRadius: "50%", background: "#6C9FFF", animation: `pulse 1.2s ease-in-out ${i*0.2}s infinite` }} />)}</div>
    </div>
  );
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
      <div style={{ marginBottom: 16 }}><div style={{ fontSize: 16, fontWeight: 700, color: "#E8EDFF", marginBottom: 3 }}>🌐 翻訳</div><div style={{ fontSize: 12, color: "#4A5580" }}>テキストを入力して、訳す言語を選んでください</div></div>
      {error && <div style={{ background: "rgba(255,107,107,0.1)", border: "1px solid rgba(255,107,107,0.3)", borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 13, color: "#FF6B6B" }}>{error}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div>
          <label style={{ fontSize: 11, color: "#4A5580", fontWeight: 600, display: "block", marginBottom: 5 }}>訳す言語</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {LANGS.map(([k, l]) => <button key={k} onClick={() => { setTarget(k); try { localStorage.setItem("ai_sec_lang", k); } catch {} }} style={{ padding: "6px 12px", borderRadius: 16, border: "1px solid", borderColor: target === k ? "#6C9FFF" : "#2A3555", background: target === k ? "rgba(108,159,255,0.15)" : "transparent", color: target === k ? "#6C9FFF" : "#B8C7FF", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>{l}</button>)}
          </div>
        </div>
        <div><label style={{ fontSize: 11, color: "#4A5580", fontWeight: 600, display: "block", marginBottom: 5 }}>原文 <span style={{ color: "#FF6B6B" }}>*</span></label><textarea value={text} onChange={e => setText(e.target.value)} placeholder="翻訳したいテキストを入力または貼り付け..." rows={8} style={{ width: "100%", background: "#1E2740", border: "1px solid #2A3555", borderRadius: 10, padding: "11px 13px", color: "#E8EDFF", fontSize: 13, outline: "none", fontFamily: "inherit", resize: "vertical", lineHeight: 1.7 }} /></div>
        <button onClick={run} disabled={!text.trim()} style={{ padding: "12px", borderRadius: 12, border: "none", background: text.trim() ? "linear-gradient(135deg, #6C9FFF, #818CF8)" : "#2A3555", color: "#fff", cursor: text.trim() ? "pointer" : "default", fontSize: 14, fontWeight: 700 }}>🌐 {target}に翻訳する</button>
      </div>
      {step === "result" && result && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: "#6C9FFF", fontWeight: 600 }}>訳文（{target}）</span>
            <button onClick={() => { navigator.clipboard.writeText(result); setCopied(true); setTimeout(() => setCopied(false), 2000); }} style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid #2A3555", background: copied ? "rgba(74,222,128,0.15)" : "transparent", color: copied ? "#4ADE80" : "#6C9FFF", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>{copied ? "✓ コピー済" : "📋 コピー"}</button>
          </div>
          <div style={{ background: "#1E2740", borderRadius: 14, padding: 16, border: "1px solid #2A3555", fontSize: 14, color: "#E8EDFF", lineHeight: 1.9, whiteSpace: "pre-wrap" }}>{result}</div>
        </div>
      )}
    </div>
  );
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
      <div style={{ maxWidth: "80%", padding: "11px 15px", borderRadius: isUser ? "18px 18px 4px 18px" : "18px 18px 18px 4px", background: isUser ? "linear-gradient(135deg, #6C9FFF, #818CF8)" : "#1E2740", color: isUser ? "#fff" : "#B8C7FF", fontSize: 14, lineHeight: 1.7, whiteSpace: isUser ? "pre-wrap" : "normal", boxShadow: isUser ? "0 4px 15px rgba(108,159,255,0.3)" : "0 2px 8px rgba(0,0,0,0.3)" }}>
        {isUser ? msg.content : <Markdown text={msg.content} />}
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

  function selectTone(key) { setReplyTone(key); localStorage.setItem("ai_sec_reply_tone", key); }
  const currentTone = TONE_OPTIONS.find(t => t.key === replyTone) || TONE_OPTIONS[1];

  async function analyze() {
    if (!body.trim()) return;
    setStep("loading"); setError("");
    try {
      const emailText = [sender ? `差出人: ${sender}` : "", subject ? `件名: ${subject}` : "", `\n本文:\n${body}`].filter(Boolean).join("\n");
      const toneInstruction = `\n\n返信文の文体について: ${currentTone.instruction}`;
      const promptBase = getBackend() === "lmstudio" ? EMAIL_REPLY_PROMPT_SIMPLE : EMAIL_REPLY_PROMPT;
      const data = await callClaude({ system: promptBase + toneInstruction, json: true, messages: [{ role: "user", content: `以下のメールに対して返信案を作成してください。\n\n${emailText}${customNote ? `\n\n補足: ${customNote}` : ""}` }] });
      const parsed = JSON.parse((data.content?.[0]?.text || "").replace(/```json|```/g, "").trim());
      setResult(parsed); setSelectedReply(0); setStep("result");
    } catch (e) {
      const isJsonError = e.message.includes("JSON");
      setError(isJsonError ? "応答が途中で切れてしまい、解析できませんでした。もう一度お試しください。" : "解析に失敗しました：" + e.message);
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
          {result.replies?.map((r,i) => <button key={i} onClick={() => setSelectedReply(i)} style={{ padding: "9px 14px", borderRadius: 10, border: "1px solid", borderColor: selectedReply===i ? "#6C9FFF" : "#2A3555", background: selectedReply===i ? "rgba(108,159,255,0.12)" : "#1E2740", color: selectedReply===i ? "#6C9FFF" : "#B8C7FF", cursor: "pointer", textAlign: "left", fontSize: 13, fontWeight: 600 }}>{["✅","⏳","🙏"][i] || "✉️"} {r.label}</button>)}
        </div>
        {reply && (
          <div style={{ background: "#1E2740", borderRadius: 14, border: "1px solid #2A3555", overflow: "hidden", marginBottom: 14 }}>
            <div style={{ padding: "11px 14px", borderBottom: "1px solid #2A3555", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div><div style={{ fontSize: 11, color: "#4A5580", marginBottom: 3 }}>件名</div><div style={{ fontSize: 13, color: "#E8EDFF", fontWeight: 600 }}>{reply.subject}</div></div>
              <div style={{ display: "flex", gap: 6 }}>
                <a href={`mailto:?subject=${encodeURIComponent(reply.subject)}&body=${encodeURIComponent(reply.body)}`} style={{ padding: "5px 11px", borderRadius: 8, border: "1px solid #2A3555", color: "#6C9FFF", fontSize: 12, fontWeight: 600, textDecoration: "none" }}>✉️ メールで開く</a>
                <button onClick={() => copy(`件名: ${reply.subject}\n\n${reply.body}`)} style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid #2A3555", background: copied ? "rgba(74,222,128,0.15)" : "transparent", color: copied ? "#4ADE80" : "#6C9FFF", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>{copied ? "✓ コピー済" : "📋 コピー"}</button>
              </div>
            </div>
            <div style={{ padding: 14 }}><div style={{ fontSize: 11, color: "#4A5580", marginBottom: 6 }}>本文</div><div style={{ fontSize: 13, color: "#B8C7FF", lineHeight: 1.9, whiteSpace: "pre-wrap" }}>{reply.body}</div></div>
          </div>
        )}
        <button onClick={() => { setStep("input"); setResult(null); }} style={{ width: "100%", padding: 11, borderRadius: 10, border: "1px solid #2A3555", background: "transparent", color: "#4A5580", cursor: "pointer", fontSize: 13 }}>← 別のメールを解析する</button>
        <button onClick={analyze} style={{ width: "100%", padding: 9, borderRadius: 10, border: "none", background: "transparent", color: "#6C9FFF", cursor: "pointer", fontSize: 12, marginTop: 6 }}>🔄 同じメールを{currentTone.icon} {currentTone.label}トーンで再生成</button>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
      <div style={{ marginBottom: 16 }}><div style={{ fontSize: 16, fontWeight: 700, color: "#E8EDFF", marginBottom: 3 }}>📨 メール返信アシスタント</div><div style={{ fontSize: 12, color: "#4A5580" }}>受信メールを貼り付けると返信案を自動生成します</div></div>
      <div style={{ background: "#1E2740", borderRadius: 12, padding: 14, marginBottom: 14, border: "1px solid #2A3555" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <span style={{ fontSize: 11, color: "#4A5580", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8 }}>🎙️ 返信のトーン</span>
          <span style={{ fontSize: 11, color: "#6C9FFF" }}>{currentTone.icon} {currentTone.label}</span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {TONE_OPTIONS.map(t => (
            <button key={t.key} onClick={() => selectTone(t.key)} title={t.desc} style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 11px", borderRadius: 16, border: "1px solid", borderColor: replyTone === t.key ? "#6C9FFF" : "#2A3555", background: replyTone === t.key ? "rgba(108,159,255,0.15)" : "transparent", color: replyTone === t.key ? "#6C9FFF" : "#B8C7FF", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
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
        <button onClick={analyze} disabled={!body.trim()} style={{ padding: "12px", borderRadius: 12, border: "none", background: body.trim() ? "linear-gradient(135deg, #6C9FFF, #818CF8)" : "#2A3555", color: "#fff", cursor: body.trim() ? "pointer" : "default", fontSize: 14, fontWeight: 700 }}>🤖 返信案を生成する</button>
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
      setError(isJsonError ? "応答が途中で切れてしまい、議事録を解析できませんでした。文字起こしを短く分割するか、もう一度お試しください。" : "議事録の生成に失敗しました：" + e.message);
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
      <ExportBar name={result.title || "議事録"} title={result.title || "議事録"} markdown={result.fullMinutes || result.summary || ""} noMarkdown />
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
          <div style={{ padding: 16 }}><Markdown text={result.fullMinutes} /></div>
        </div>
      )}
      <button onClick={() => { setStep("input"); setResult(null); setTranscript(""); setMeta(""); }} style={{ width: "100%", padding: 11, borderRadius: 10, border: "1px solid #2A3555", background: "transparent", color: "#4A5580", cursor: "pointer", fontSize: 13, marginTop: 14 }}>← 別の文字起こしを解析する</button>
    </div>
  );

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
      <div style={{ marginBottom: 16 }}><div style={{ fontSize: 16, fontWeight: 700, color: "#E8EDFF", marginBottom: 3 }}>📝 議事録アシスタント</div><div style={{ fontSize: 12, color: "#4A5580" }}>会議の文字起こしを貼り付けると議事録を自動生成します</div></div>
      {error && <div style={{ background: "rgba(255,107,107,0.1)", border: "1px solid rgba(255,107,107,0.3)", borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 13, color: "#FF6B6B" }}>{error}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div><label style={{ fontSize: 11, color: "#4A5580", fontWeight: 600, display: "block", marginBottom: 5 }}>補足情報（任意）</label><input value={meta} onChange={e => setMeta(e.target.value)} placeholder="例: 2024年6月16日 / プロジェクト定例会" style={{ width: "100%", background: "#1E2740", border: "1px solid #2A3555", borderRadius: 10, padding: "9px 13px", color: "#E8EDFF", fontSize: 13, outline: "none", fontFamily: "inherit" }} /></div>
        <div><label style={{ fontSize: 11, color: "#4A5580", fontWeight: 600, display: "block", marginBottom: 5 }}>文字起こし <span style={{ color: "#FF6B6B" }}>*</span></label><textarea value={transcript} onChange={e => setTranscript(e.target.value)} placeholder={"会議の文字起こしをここに貼り付けてください..."} rows={10} style={{ width: "100%", background: "#1E2740", border: "1px solid #2A3555", borderRadius: 10, padding: "11px 13px", color: "#E8EDFF", fontSize: 13, outline: "none", fontFamily: "inherit", resize: "vertical", lineHeight: 1.7 }} /></div>
        <button onClick={generate} disabled={!transcript.trim()} style={{ padding: "12px", borderRadius: 12, border: "none", background: transcript.trim() ? "linear-gradient(135deg, #6C9FFF, #818CF8)" : "#2A3555", color: "#fff", cursor: transcript.trim() ? "pointer" : "default", fontSize: 14, fontWeight: 700 }}>🤖 議事録を生成する</button>
      </div>
    </div>
  );
}

function FileAnalysisView() {
  const [fileName, setFileName] = useState("");
  const [docText, setDocText] = useState("");
  const [question, setQuestion] = useState("");
  const [step, setStep] = useState("input");
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [truncated, setTruncated] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef(null);

  async function handleFile(file) {
    if (!file) return;
    setError(""); setResult(""); setTruncated(false); setStep("extracting"); setFileName(file.name);
    try {
      let text = (await extractFileText(file)).trim();
      if (!text) throw new Error("テキストを抽出できませんでした（画像だけのPDFなどの可能性があります）。");
      const tr = text.length > MAX_DOC_CHARS;
      setTruncated(tr);
      setDocText(tr ? text.slice(0, MAX_DOC_CHARS) : text);
      setStep("input");
    } catch (err) {
      setError("読み込みに失敗しました：" + err.message);
      setFileName(""); setDocText(""); setStep("input");
    }
  }
  function onPick(e) { handleFile(e.target.files && e.target.files[0]); }
  function onDrop(e) { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]); }

  async function analyze() {
    if (!docText) return;
    setStep("loading"); setError("");
    try {
      const q = question.trim() ? `【質問】${question.trim()}\n\n` : "この文書を解析し、要約と重要ポイントを教えてください。\n\n";
      const data = await callClaude({ system: FILE_ANALYSIS_PROMPT, max_tokens: 4000, messages: [{ role: "user", content: `${q}【文書「${fileName}」の内容】\n${docText}` }] });
      setResult(data.content?.[0]?.text || "（応答が空でした）");
      setStep("result");
    } catch (e) {
      setError("解析に失敗しました：" + e.message);
      setStep("input");
    }
  }
  function copyResult() { navigator.clipboard.writeText(result).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }
  function reset() { setFileName(""); setDocText(""); setQuestion(""); setResult(""); setError(""); setTruncated(false); setStep("input"); if (fileRef.current) fileRef.current.value = ""; }

  if (step === "loading" || step === "extracting") return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20, padding: 24 }}>
      <div style={{ width: 56, height: 56, borderRadius: "50%", background: "linear-gradient(135deg, #6C9FFF, #A78BFA)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, animation: "glow 2s ease-in-out infinite" }}>📎</div>
      <div style={{ textAlign: "center" }}><div style={{ fontSize: 15, fontWeight: 600, color: "#E8EDFF", marginBottom: 6 }}>{step === "extracting" ? "ファイルを読み込み中..." : "文書を解析中..."}</div><div style={{ fontSize: 13, color: "#4A5580" }}>{step === "extracting" ? "テキストを抽出しています" : "内容をまとめています"}</div></div>
      <div style={{ display: "flex", gap: 6 }}>{[0,1,2].map(i => <div key={i} style={{ width: 10, height: 10, borderRadius: "50%", background: "#6C9FFF", animation: `pulse 1.2s ease-in-out ${i*0.2}s infinite` }} />)}</div>
    </div>
  );

  if (step === "result") return (
    <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: "#6C9FFF", fontWeight: 600 }}>📎 {fileName}</span>
        <button onClick={copyResult} style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid #2A3555", background: copied ? "rgba(74,222,128,0.15)" : "transparent", color: copied ? "#4ADE80" : "#6C9FFF", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>{copied ? "✓ コピー済" : "📋 コピー"}</button>
      </div>
      <ExportBar name={fileName || "解析結果"} title={"解析結果 " + fileName} markdown={result} />
      <div style={{ background: "#1E2740", borderRadius: 14, padding: 16, border: "1px solid #2A3555", marginBottom: 14 }}><Markdown text={result} /></div>
      <button onClick={reset} style={{ width: "100%", padding: 11, borderRadius: 10, border: "1px solid #2A3555", background: "transparent", color: "#4A5580", cursor: "pointer", fontSize: 13 }}>← 別のファイルを解析する</button>
    </div>
  );

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
      <div style={{ marginBottom: 16 }}><div style={{ fontSize: 16, fontWeight: 700, color: "#E8EDFF", marginBottom: 3 }}>📎 ファイル解析</div><div style={{ fontSize: 12, color: "#4A5580" }}>文書を添付すると内容を読み取り、要約や質問への回答ができます</div></div>
      {error && <div style={{ background: "rgba(255,107,107,0.1)", border: "1px solid rgba(255,107,107,0.3)", borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 13, color: "#FF6B6B" }}>{error}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <label style={{ fontSize: 11, color: "#4A5580", fontWeight: 600, display: "block", marginBottom: 5 }}>ファイル <span style={{ color: "#FF6B6B" }}>*</span></label>
          <div onClick={() => fileRef.current && fileRef.current.click()} onDragOver={e => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={onDrop} style={{ width: "100%", padding: "26px 18px", borderRadius: 12, border: dragOver ? "2px dashed #6C9FFF" : "1px dashed #2A3555", background: dragOver ? "rgba(108,159,255,0.12)" : "#1E2740", color: fileName ? "#E8EDFF" : "#4A5580", cursor: "pointer", fontSize: 13, fontWeight: 600, textAlign: "center" }}>
            {fileName ? `📄 ${fileName}` : (dragOver ? "ここにドロップしてください" : "クリックで選択、または ここにドラッグ＆ドロップ")}
          </div>
          <input ref={fileRef} type="file" onChange={onPick} accept=".txt,.md,.markdown,.csv,.tsv,.json,.log,.xml,.yml,.yaml,.html,.htm,.pdf,.docx,.xlsx,.xls" style={{ display: "none" }} />
          <div style={{ fontSize: 11, color: "#4A5580", marginTop: 6 }}>対応形式: PDF / Word(.docx) / Excel(.xlsx) / テキスト / CSV / Markdown など</div>
          {truncated && <div style={{ fontSize: 11, color: "#FFD93D", marginTop: 6 }}>※文書が長いため、先頭の約{MAX_DOC_CHARS.toLocaleString()}文字のみを解析対象にしています。</div>}
        </div>
        <div>
          <label style={{ fontSize: 11, color: "#4A5580", fontWeight: 600, display: "block", marginBottom: 5 }}>聞きたいこと（任意）</label>
          <input value={question} onChange={e => setQuestion(e.target.value)} placeholder="例: 結論だけ教えて / 金額の合計は？（空欄なら要約します）" style={{ width: "100%", background: "#1E2740", border: "1px solid #2A3555", borderRadius: 10, padding: "9px 13px", color: "#E8EDFF", fontSize: 13, outline: "none", fontFamily: "inherit" }} />
        </div>
        <button onClick={analyze} disabled={!docText} style={{ padding: "12px", borderRadius: 12, border: "none", background: docText ? "linear-gradient(135deg, #6C9FFF, #818CF8)" : "#2A3555", color: "#fff", cursor: docText ? "pointer" : "default", fontSize: 14, fontWeight: 700 }}>🤖 この文書を解析する</button>
      </div>
    </div>
  );
}

export default function AISecretary() {
  const DEFAULT_MSG = { role: "assistant", content: "こんにちは！私はあなたのAI秘書です。\n\nチャット・メール返信・議事録・ファイル解析など、お仕事のサポートをお任せください。今日は何からお手伝いしましょうか？" };
  const [messages, setMessages] = useState(() => { try { const s = localStorage.getItem("ai_sec_msgs"); if (s) return JSON.parse(s); } catch {} return [DEFAULT_MSG]; });
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState("chat");
  const [backend, setBackend] = useState(() => getBackend());
  const [geminiCount, setGeminiCount] = useState(getGeminiCount());
  const [tasks, setTasks] = useState(() => { try { const s = localStorage.getItem("ai_sec_tasks"); if (s) return JSON.parse(s); } catch {} return [
    { id: 1, text: "Q3レポートの確認", done: false, priority: "high" },
    { id: 2, text: "チームミーティングの準備", done: false, priority: "medium" },
    { id: 3, text: "クライアントへの返信", done: true, priority: "high" },
  ]; });
  const [newTask, setNewTask] = useState("");
  const [attachedDoc, setAttachedDoc] = useState(null);
  const [templates, setTemplates] = useState(() => { try { const s = localStorage.getItem("ai_sec_templates"); if (s) return JSON.parse(s); } catch {} return []; });
  const [showTemplates, setShowTemplates] = useState(false);
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);
  const chatFileRef = useRef(null);

  const onLocal = typeof window !== "undefined" && window.location && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
  const isLM = backend === "lmstudio";

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);
  useEffect(() => { try { localStorage.setItem("ai_sec_msgs", JSON.stringify(messages)); } catch {} }, [messages]);
  useEffect(() => { try { localStorage.setItem("ai_sec_tasks", JSON.stringify(tasks)); } catch {} }, [tasks]);
  useEffect(() => { try { localStorage.setItem("ai_sec_templates", JSON.stringify(templates)); } catch {} }, [templates]);
  useEffect(() => { const id = setInterval(() => setGeminiCount(getGeminiCount()), 4000); return () => clearInterval(id); }, []);

  function toggleBackend() { const next = backend === "lmstudio" ? "gemini" : "lmstudio"; setBackend(next); try { localStorage.setItem(BACKEND_KEY, next); } catch {} }

  // 回答を少しずつ表示するストリーミング風の演出
  function revealAssistant(full) {
    return new Promise(resolve => {
      setMessages(prev => [...prev, { role: "assistant", content: "" }]);
      const total = full.length, steps = 36, dur = Math.min(1200, Math.max(250, total * 6));
      let st = 0;
      const id = setInterval(() => {
        st++;
        const idx = Math.ceil((total * st) / steps);
        setMessages(prev => { const c = prev.slice(); c[c.length - 1] = { role: "assistant", content: full.slice(0, idx) }; return c; });
        if (st >= steps) { clearInterval(id); resolve(); }
      }, dur / steps);
    });
  }

  async function sendMessage(text) {
    if (!text.trim() || loading) return;
    const userMsg = { role: "user", content: text };
    const updated = [...messages, userMsg];
    setMessages(updated); setInput(""); setLoading(true);
    const sys = attachedDoc
      ? SYSTEM_PROMPT + "\n\n以下は添付された文書です。ユーザーの質問にはこの内容を踏まえて答えてください。\n【添付文書「" + attachedDoc.name + "」】\n" + attachedDoc.text
      : SYSTEM_PROMPT;
    const payloadMsgs = updated.map(m => ({ role: m.role, content: m.content }));
    try {
      const data = await callClaude({ system: sys, messages: payloadMsgs });
      setGeminiCount(getGeminiCount());
      await revealAssistant(data.content?.[0]?.text || "エラーが発生しました。");
    } catch (e) {
      const quota = /上限|quota|429|exceeded/i.test(e.message);
      if (quota && onLocal && getBackend() === "gemini") {
        try {
          setBackend("lmstudio"); try { localStorage.setItem(BACKEND_KEY, "lmstudio"); } catch {}
          const data2 = await callClaude({ system: sys, messages: payloadMsgs });
          await revealAssistant("（Geminiが上限のためLM Studioに切り替えました）\n\n" + (data2.content?.[0]?.text || ""));
          setLoading(false); return;
        } catch (e2) { e = e2; }
      }
      setMessages(prev => [...prev, { role: "assistant", content: "エラー: " + e.message }]);
    } finally { setLoading(false); }
  }

  async function onChatAttach(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      let text = (await extractFileText(file)).trim();
      if (text.length > MAX_DOC_CHARS) text = text.slice(0, MAX_DOC_CHARS);
      setAttachedDoc({ name: file.name, text });
    } catch (err) {
      setMessages(prev => [...prev, { role: "assistant", content: "ファイルの読み込みに失敗しました：" + err.message }]);
    }
    if (chatFileRef.current) chatFileRef.current.value = "";
  }

  function saveCurrentAsTemplate() { const t = input.trim(); if (!t) return; const title = t.split("\n")[0].slice(0, 24); setTemplates(prev => [...prev, { id: Date.now(), title, text: t }]); }
  function insertTemplate(text) { setInput(prev => (prev ? prev + "\n" : "") + text); setShowTemplates(false); }
  function removeTemplate(id) { setTemplates(prev => prev.filter(t => t.id !== id)); }
  function clearChat() { setMessages([DEFAULT_MSG]); setAttachedDoc(null); }

  function handleKey(e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }
  const priorityColor = { high: "#FF6B6B", medium: "#FFD93D", low: "#6BCB77" };
  const NAV = [{ key: "chat", icon: "💬", label: "チャット" }, { key: "email", icon: "📨", label: "返信" }, { key: "minutes", icon: "📝", label: "議事録" }, { key: "file", icon: "📎", label: "ファイル" }, { key: "translate", icon: "🌐", label: "翻訳" }, { key: "tasks", icon: "✅", label: "タスク" }];
  const iconBtn = { width: 34, height: 34, borderRadius: 10, border: "1px solid #2A3555", background: "transparent", color: "#6C9FFF", cursor: "pointer", fontSize: 15, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" };

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
        .md { font-size: 14px; line-height: 1.7; color: #B8C7FF; }
        .md h3,.md h4,.md h5,.md h6 { color: #E8EDFF; margin: 10px 0 4px; font-size: 14px; }
        .md ul,.md ol { margin: 4px 0; padding-left: 20px; }
        .md li { margin: 2px 0; }
        .md code { background: #0A0E1A; padding: 1px 5px; border-radius: 4px; font-size: 12px; }
        .md pre { background: #0A0E1A; padding: 10px; border-radius: 8px; overflow-x: auto; font-size: 12px; white-space: pre-wrap; }
        .md a { color: #6C9FFF; }
        .md strong { color: #E8EDFF; }
        .md div { margin: 2px 0; }
      `}</style>

      <div style={{ background: "rgba(30,39,64,0.95)", backdropFilter: "blur(12px)", borderBottom: "1px solid #1E2740", flexShrink: 0 }}>
        <div style={{ padding: "8px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: "linear-gradient(135deg, #6C9FFF, #A78BFA)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, boxShadow: "0 0 10px rgba(108,159,255,0.4)", flexShrink: 0 }}>🤖</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#E8EDFF" }}>AI秘書 <span style={{ fontSize: 9, color: "#4A5580", fontWeight: 400 }}>v{APP_VERSION}</span></span>
              <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
                <button onClick={toggleBackend} title="PCの接続先を切り替え（スマホは常にGemini）" style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 12, border: "1px solid", borderColor: isLM ? "rgba(108,159,255,0.5)" : "rgba(167,139,250,0.5)", background: isLM ? "rgba(108,159,255,0.12)" : "rgba(167,139,250,0.12)", color: isLM ? "#6C9FFF" : "#A78BFA", cursor: "pointer", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>
                  <span>{isLM ? "🖥" : "☁"}</span>{isLM ? "LM Studio" : "Gemini"}<span style={{ opacity: 0.6, fontWeight: 400 }}>切替</span>
                </button>
                {!onLocal && <a href="http://localhost:8080" title="ローカル(LM Studio)版を開く ※同じPCでサーバー起動が必要" style={{ display: "flex", alignItems: "center", gap: 3, padding: "2px 8px", borderRadius: 12, border: "1px solid rgba(108,159,255,0.4)", background: "transparent", color: "#6C9FFF", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap", textDecoration: "none" }}>🖥 ローカル版</a>}
                <span title="本日のGemini利用回数（無料枠の目安は約20回/日）" style={{ fontSize: 10, color: geminiCount >= 18 ? "#FF6B6B" : "#4A5580", whiteSpace: "nowrap" }}>☁ {geminiCount}/20</span>
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 3, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {NAV.map(({ key, icon, label }) => (
              <button key={key} onClick={() => setView(key)} style={{ padding: "5px 8px", borderRadius: 14, border: "1px solid", borderColor: view===key ? "#6C9FFF" : "transparent", background: view===key ? "rgba(108,159,255,0.15)" : "transparent", color: view===key ? "#6C9FFF" : "#4A5580", cursor: "pointer", fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center", gap: 3 }}>
                <span>{icon}</span><span>{label}</span>
              </button>
            ))}
          </div>
        </div>
        {view === "chat" && (
          <div style={{ padding: "0 16px 8px", display: "flex", gap: 6, borderTop: "1px solid #1a2238", alignItems: "center" }}>
            <span style={{ fontSize: 10, color: "#4A5580", alignSelf: "center", whiteSpace: "nowrap", marginRight: 2 }}>クイック：</span>
            {QUICK_ACTIONS.map(a => (
              <button key={a.label} onClick={() => sendMessage(a.prompt)} style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 14, border: "1px solid #2A3555", background: "transparent", color: "#B8C7FF", cursor: "pointer", fontSize: 12, fontWeight: 500, whiteSpace: "nowrap" }}>
                <span style={{ fontSize: 13 }}>{a.icon}</span>{a.label}
              </button>
            ))}
            <button onClick={clearChat} title="チャット履歴をクリア" style={{ marginLeft: "auto", padding: "4px 10px", borderRadius: 14, border: "1px solid #2A3555", background: "transparent", color: "#4A5580", cursor: "pointer", fontSize: 12, whiteSpace: "nowrap" }}>🗑 履歴</button>
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
            <div style={{ padding: "10px 16px 12px", background: "rgba(10,14,26,0.95)", borderTop: "1px solid #1E2740", flexShrink: 0 }}>
              {attachedDoc && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                  <span style={{ fontSize: 12, color: "#6C9FFF", background: "rgba(108,159,255,0.12)", border: "1px solid #2A3555", borderRadius: 14, padding: "3px 10px" }}>📎 {attachedDoc.name}（添付中）</span>
                  <button onClick={() => setAttachedDoc(null)} style={{ background: "none", border: "none", color: "#4A5580", cursor: "pointer", fontSize: 15 }}>×</button>
                </div>
              )}
              {showTemplates && (
                <div style={{ background: "#1E2740", border: "1px solid #2A3555", borderRadius: 12, padding: 10, marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontSize: 11, color: "#4A5580", fontWeight: 700 }}>📋 定型文</span>
                    <button onClick={saveCurrentAsTemplate} style={{ fontSize: 11, color: "#6C9FFF", background: "none", border: "1px solid #2A3555", borderRadius: 8, padding: "3px 8px", cursor: "pointer" }}>現在の入力を保存</button>
                  </div>
                  {templates.length === 0 ? <div style={{ fontSize: 11, color: "#4A5580" }}>保存された定型文はありません。よく使う文章を入力欄に書いて「現在の入力を保存」を押すと登録できます。</div> :
                    templates.map(t => (
                      <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                        <button onClick={() => insertTemplate(t.text)} style={{ flex: 1, textAlign: "left", fontSize: 12, color: "#B8C7FF", background: "#0A0E1A", border: "1px solid #2A3555", borderRadius: 8, padding: "6px 10px", cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.title}</button>
                        <button onClick={() => removeTemplate(t.id)} style={{ background: "none", border: "none", color: "#4A5580", cursor: "pointer", fontSize: 16 }}>×</button>
                      </div>
                    ))
                  }
                </div>
              )}
              <div style={{ display: "flex", gap: 6, background: "#1E2740", borderRadius: 14, padding: "7px", border: "1px solid #2A3555", alignItems: "flex-end" }}>
                <button onClick={() => chatFileRef.current && chatFileRef.current.click()} title="ファイルを添付して質問" style={iconBtn}>📎</button>
                <button onClick={() => setShowTemplates(s => !s)} title="定型文" style={{ ...iconBtn, color: showTemplates ? "#0A0E1A" : "#6C9FFF", background: showTemplates ? "#6C9FFF" : "transparent" }}>📋</button>
                <input ref={chatFileRef} type="file" onChange={onChatAttach} accept=".txt,.md,.markdown,.csv,.tsv,.json,.log,.xml,.yml,.yaml,.html,.htm,.pdf,.docx,.xlsx,.xls" style={{ display: "none" }} />
                <textarea ref={textareaRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKey} placeholder={attachedDoc ? "添付した文書について質問できます..." : "メッセージを入力..."} rows={1} style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "#E8EDFF", fontSize: 16, lineHeight: 1.6, fontFamily: "inherit", maxHeight: 100, overflowY: "auto", paddingBottom: 6 }} />
                <button onClick={() => sendMessage(input)} disabled={!input.trim() || loading} style={{ width: 34, height: 34, borderRadius: 10, border: "none", background: input.trim() && !loading ? "linear-gradient(135deg, #6C9FFF, #818CF8)" : "#2A3555", color: "#fff", cursor: input.trim() && !loading ? "pointer" : "default", fontSize: 14, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>➤</button>
              </div>
            </div>
          </>
        )}
        {view === "email" && <EmailReplyView />}
        {view === "minutes" && <MinutesView />}
        {view === "file" && <FileAnalysisView />}
        {view === "translate" && <TranslateView />}
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
