import * as vscode from 'vscode';
import express, { Request, Response } from 'express';
import * as http from 'http';
import puppeteer, { Browser } from 'puppeteer-core';

let server: http.Server | null = null;
let browser: Browser | null = null;

export async function activate(context: vscode.ExtensionContext) {
  const app = express();

  app.get('/proxy', async (req: Request, res: Response) => {
    const target = (req.query.url as string | undefined) ?? '';
    if (!target) {
      res.status(400).send('missing url');
      return;
    }

    try {
      if (!browser) {
        browser = await puppeteer.launch({
          executablePath:
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
      }

      const page = await browser.newPage();
      await page.setBypassCSP(true);
      await page.goto(target, { waitUntil: 'networkidle2', timeout: 30000 });

      const html = await page.content();

      res.set('Content-Type', 'text/html; charset=utf-8');
      res.send(html);

      await page.close();
    } catch (e: any) {
      console.error('proxy error:', e);
      res.status(500).send('proxy error: ' + e?.message);
    }
  });

  const port = await startServer(app);

  const disposable = vscode.commands.registerCommand(
    'urlPreview.open',
    async () => {
      const input = await vscode.window.showInputBox({
        prompt: '表示したい URL を入力してください'
      });
      if (!input) return;

      const panel = vscode.window.createWebviewPanel(
        'urlPreview',
        `Preview: ${input}`,
        vscode.ViewColumn.Two,
        {
          enableScripts: true,
          retainContextWhenHidden: true
        }
      );

      const iframeSrc = `http://127.0.0.1:${port}/proxy?url=${encodeURIComponent(
        input
      )}`;

      panel.webview.html = `
      <!doctype html>
      <html>
        <body style="margin:0">
          <iframe src="${iframeSrc}" style="width:100%;height:100vh;border:0;"></iframe>
        </body>
      </html>`;
    }
  );

  context.subscriptions.push(disposable);

  context.subscriptions.push({
    dispose: async () => {
      if (server) server.close();
      if (browser) await browser.close();
    }
  });
}

async function startServer(app: express.Express): Promise<number> {
  return new Promise((resolve, reject) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server!.address() as any;
      resolve(addr.port as number);
    });

    server.on('error', reject);
  });
}

export async function deactivate() {
  if (server) server.close();
  if (browser) await browser?.close();
}
