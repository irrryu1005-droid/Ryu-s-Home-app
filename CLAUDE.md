# home-app プロジェクト設定

## 「ありがとう」ルール（最重要）

ユーザーが「ありがとう」と言ったら、**返答する前に必ず**以下を実行する:

1. このセッションで行った変更・発見・解決したバグを洗い出す
2. 該当するObsidianノートを更新する（直接ファイルに書き込む）:
   - 機能追加・変更 → `Projects/` の該当アプリノート
   - バグ解決・API発見 → `Knowledge/` に新規 or 追記
   - 設計判断 → `Decisions/`
3. 「Obsidian: ○○を更新しました」と報告してから返答する

**Obsidianのパス**: `/Users/ryu_i/Desktop/obsidian/`

git push はフック（UserPromptSubmit hook）が自動で行うので、Claudeは実行しない。

---

## プロジェクト概要

- **場所**: `/Users/ryu_i/Library/Mobile Documents/com~apple~CloudDocs/home-app/`
- **スタック**: Vanilla JS + Supabase + Netlify Functions
- **デプロイ**: GitHub main → Netlify 自動デプロイ
