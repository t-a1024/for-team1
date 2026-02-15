import * as vscode from 'vscode';
import fetch from 'node-fetch'; // optional: fetch-mode を使うならインストール

export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand('urlPreview.open', async () => {
    // URL をユーザーに入力してもらう（または設定から読む実装に置き換え）
    const url = await vscode.window.showInputBox({ prompt: '表示したい URL を入力してください (例: https://example.com)' });
    if (!url) { return; }

    // モード: 'iframe' または 'fetch'
    const mode: 'iframe' | 'fetch' = 'fetch';

    // WebviewPanel を右側(2列目)で開く
    const panel = vscode.window.createWebviewPanel(
      'urlPreview',                                  // viewType
      `Preview: ${url}`,                             // title
      vscode.ViewColumn.Two,                         // 右側（第2カラム）に表示
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    if (mode === 'iframe') {
      // iframe モード（簡単だが X-Frame-Options の影響を受ける）
      panel.webview.html = getIframeHtml(url);
    } else {
      // fetch モード（拡張ホストが HTML を取得して埋め込む）
      try {
        const raw = await fetchHtml(url);
        panel.webview.html = getEmbeddedHtml(raw, url);
      } catch (err: any) {
        panel.webview.html = `<html><body><h3>取得に失敗しました：</h3><pre>${err.message}</pre></body></html>`;
      }
    }
  });

  context.subscriptions.push(disposable);
}

export function deactivate() {}

/* --- ヘルパー --- */

function getIframeHtml(url: string): string {
  // Webview 用に簡単なスタイルを付ける
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${url}; style-src 'unsafe-inline';">
    <style>html,body,iframe{height:100%;margin:0;padding:0;border:0} iframe{width:100%;}</style>
  </head>
  <body>
    <iframe src="${escapeHtml(url)}" frameborder="0"></iframe>
  </body>
</html>`;
}

async function fetchHtml(url: string): Promise<string> {
  // node-fetch を利用（事前に npm install node-fetch@2 を推奨）
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return await res.text();
}

function getEmbeddedHtml(rawHtml: string, baseUrl: string): string {
  // 相対パス対策として <base> を挿入すると、相対リンクが baseUrl を基準に解決される
  // 注意: 外部スクリプトや特殊な CSP のあるページでは動かない可能性あり
  const base = `<base href="${escapeHtml(baseUrl)}">`;
  // 単純に <head> の直後に挿入する（厳密にはパーサでやるべきだが簡易対応）
  let html = rawHtml;
  const headTag = /<head[^>]*>/i;
  if (headTag.test(html)) {
    html = html.replace(headTag, (m) => m + base);
  } else {
    // head が無ければ先頭に挿入
    html = base + html;
  }

  // Webview の CSP を緩める（注意: セキュリティ上の配慮が必要）
  const wrapper = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none' data: blob:; img-src data: blob: https:; font-src https: data:; style-src 'unsafe-inline' https:; script-src 'unsafe-inline' 'unsafe-eval' https:;">
  </head>
  <body>${html}</body>
</html>`;
  return wrapper;
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
