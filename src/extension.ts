import * as vscode from 'vscode';

// fetch を安全に取得するユーティリティ（global fetch があればそれを使い、なければ node-fetch を require）
async function getFetch(): Promise<typeof fetch> {
  const g = (globalThis as any).fetch;
  if (g) return g;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nf = require('node-fetch'); // node-fetch@2 の場合 default import は commonjs 互換で require で OK
  return nf as any;
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** HEAD か GET でヘッダを取得して埋め込み可能かを判定する */
async function isEmbeddable(targetUrl: string): Promise<boolean> {
  try {
    const fetchFn = await getFetch();
    // まず HEAD を試す（サーバが未対応な場合は GET にフォールバック）
    let res = await fetchFn(targetUrl, { method: 'HEAD' } as any);
    if (!res || res.status === 405 || res.status === 501) {
      res = await fetchFn(targetUrl, { method: 'GET' } as any);
    }
    if (!res) return false;
    const headers: Record<string, string> = {};
    res.headers.forEach((v: string, k: string) => (headers[k.toLowerCase()] = v));

    // X-Frame-Options がある（DENY/ SAMEORIGIN 等）は iframe 埋め込み不可
    if (headers['x-frame-options']) {
      const val = headers['x-frame-options'].toLowerCase();
      if (val.includes('deny') || val.includes('sameorigin') || val.includes('same-site')) return false;
    }

    // Content-Security-Policy に frame-ancestors がある場合、埋め込み可能性を解析
    if (headers['content-security-policy']) {
      const csp = headers['content-security-policy'].toLowerCase();
      const match = csp.match(/frame-ancestors\s+([^;]+)/);
      if (match) {
        const ancestors = match[1];
        // 'self' のみなど限定的なら不可（厳密判定は難しいが簡単な判定）
        if (ancestors.includes("'none'")) return false;
        // 'self' だけだと外部からの埋め込みは不可
        if (/^\s*'self'\s*$/.test(ancestors)) return false;
      }
    }

    // 無害そうなら埋め込み可と判断
    return true;
  } catch (e) {
    // ネットワーク等の失敗時は保守的に埋め込み不可（安全側）
    return false;
  }
}

/** URL の HTML を取得して <base> を挿入する（相対パス対策） */
async function fetchHtmlAndInjectBase(targetUrl: string): Promise<string> {
  const fetchFn = await getFetch();
  const res = await fetchFn(targetUrl, { method: 'GET' } as any);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  let raw = await res.text();

  const baseTag = `<base href="${escapeHtml(targetUrl)}">`;
  const headTag = /<head[^>]*>/i;
  if (headTag.test(raw)) {
    raw = raw.replace(headTag, (m: string) => m + baseTag);
  } else {
    raw = baseTag + raw;
  }

  // Webview の sandbox 内で安全に表示するためのラッパー（必要に応じて CSP を調整）
  const wrapper = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data: blob:; font-src https: data:; style-src 'unsafe-inline' https:; script-src 'unsafe-inline' 'unsafe-eval' https:;">
  </head>
  <body>${raw}</body>
</html>`;
  return wrapper;
}

export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand('urlPreview.open', async () => {
    const input = await vscode.window.showInputBox({
      prompt: '表示したい URL を入力してください（例: https://example.com）'
    });
    if (!input) return;

    let targetUrl = input.trim();
    // 簡単な補正
    if (!/^https?:\/\//i.test(targetUrl)) targetUrl = 'https://' + targetUrl;

    const panel = vscode.window.createWebviewPanel(
      'urlPreview',
      `Preview: ${targetUrl}`,
      vscode.ViewColumn.Two,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    // 状態メッセージを先に出す
    panel.webview.html = `<html><body style="font-family: sans-serif; padding: 16px;">検査中: ${escapeHtml(targetUrl)}<br/>埋め込み可能か確認しています...</body></html>`;

    // ヘッダを調べて iframe 可否を判定
    const embedOk = await isEmbeddable(targetUrl);

    if (embedOk) {
      // iframe モード
      // Webview の CSP に frame-src を明示しておく
      panel.webview.html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${targetUrl} http: https: data:; style-src 'unsafe-inline' http: https:; script-src 'unsafe-inline' http: https:;">
    <style>html,body,iframe{height:100%;margin:0;padding:0;border:0} iframe{width:100%;}</style>
  </head>
  <body>
    <iframe src="${escapeHtml(targetUrl)}" frameborder="0"></iframe>
  </body>
</html>`;
    } else {
      // fetch 埋め込みモード（ヘッダで iframe 埋め込み不可なので拡張が取得して埋め込む）
      try {
        const embedded = await fetchHtmlAndInjectBase(targetUrl);
        panel.webview.html = embedded;
      } catch (err: any) {
        panel.webview.html = `<html><body style="font-family:sans-serif;padding:16px;"><h3>取得に失敗しました</h3><pre>${escapeHtml(String(err && err.message ? err.message : err))}</pre></body></html>`;
      }
    }
  });

  context.subscriptions.push(disposable);
}

export function deactivate() {}
