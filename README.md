# AI秘書（Gemini API版） — 導入ガイド

Claude APIの代わりに **Google Gemini API（無料枠）** を使う構成です。
Gemini 2.5 Flashモデルを使用し、1日1,500回まで無料で利用できます。

---

## 全体の流れ（所要時間：約20分）

1. Gemini APIキーを取得する（無料・クレジットカード不要）
2. GitHubにコードをアップロード
3. Vercelにデプロイ
4. 環境変数にAPIキーを設定

---

## STEP 1：Gemini APIキーを取得する

1. https://aistudio.google.com/apikey を開く
2. Googleアカウントでログイン
3. 「Create API key」をクリック
4. 表示されたキー（`AIza...` から始まる文字列）をコピーしてメモしておく

**料金について：** クレジットカードの登録は不要です。1日1,500回のリクエストまで完全無料で使えます。

---

## STEP 2：GitHubにアップロード

すでにGitHubアカウントをお持ちなので、新しいリポジトリを作成します。

1. https://github.com → 「＋」→「New repository」
2. Repository name: `ai-secretary-gemini`
3. 「Private」を選択 →「Create repository」
4. 「uploading an existing file」から、このフォルダ内の **全ファイルと全フォルダ構造を維持して** アップロード

アップロードするファイル一覧：
```
ai-secretary-gemini/
├── api/
│   └── gemini.js
├── src/
│   ├── App.jsx
│   └── main.jsx
├── .gitignore
├── index.html
├── package.json
├── vite.config.js
└── README.md
```

**重要：** 前回 `App.jsx` が見つからなくてエラーになった経緯があるため、アップロード後は必ずリポジトリ画面で `src` フォルダを開き、`App.jsx` と `main.jsx` の両方が入っているか確認してください。入っていなければ「Add file」→「Create new file」で `src/App.jsx` のように直接パスを指定して作成してください。

---

## STEP 3：Vercelにデプロイ

1. https://vercel.com → 既存のVercelアカウントでログイン
2. 「Add New Project」→ `ai-secretary-gemini` を選択
3. 「Deploy」をクリック（設定はそのままでOK）

---

## STEP 4：環境変数にAPIキーを設定

1. デプロイ完了後、プロジェクトの「Settings」→「Environment Variables」
2. 以下を追加：
   - **Key**: `GEMINI_API_KEY`
   - **Value**: STEP1でコピーしたキー（`AIza...`）
   - Environment: Production, Preview, Development すべてにチェック
3. 「Save」
4. 「Deployments」タブ→一番上のデプロイの「⋯」→「Redeploy」

→ 発行されたURL（例: `https://ai-secretary-gemini-xxxx.vercel.app`）にアクセスすれば完成です。

---

## Claude版との違い

- 使用モデル：Gemini 2.5 Flash（無料）
- 利用上限：1日1,500回、1分15回まで
- データの扱い：無料枠ではプロンプト・応答がGoogleのモデル改善に使われる場合があります。機密情報の入力には注意してください
- 機能面の見た目・操作感はClaude版と同一です（チャット・メール返信・議事録・タスク管理）

---

## 困ったときは

- ビルドエラーが出た場合は、エラーログ全文をコピーして確認を依頼してください
- 「429エラー」や「Quota exceeded」が出た場合は、1日の無料枠（1,500回）を使い切った可能性があります。翌日（太平洋時間の0時）にリセットされます
