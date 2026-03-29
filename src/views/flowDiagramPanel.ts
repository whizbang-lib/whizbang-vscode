import * as vscode from 'vscode';

/**
 * Creates and shows a WebviewPanel rendering a Mermaid flow diagram
 * using the provided mermaid code string.
 *
 * The caller is responsible for obtaining the mermaid code from the
 * language server via lspClient.generateFlowDiagram().
 */
export function showFlowDiagramPanel(
  context: vscode.ExtensionContext,
  messageType: string,
  mermaidCode: string,
): void {
  const shortName = messageType.includes('.')
    ? messageType.split('.').pop()!
    : messageType;

  const panel = vscode.window.createWebviewPanel(
    'whizbangFlowDiagram',
    `Flow: ${shortName}`,
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
    },
  );

  const isDark = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark
    || vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast;

  panel.webview.html = getWebviewHtml(mermaidCode, isDark);

  // Update theme if user changes it while panel is open
  const themeListener = vscode.window.onDidChangeActiveColorTheme((theme) => {
    const nowDark = theme.kind === vscode.ColorThemeKind.Dark
      || theme.kind === vscode.ColorThemeKind.HighContrast;
    panel.webview.html = getWebviewHtml(mermaidCode, nowDark);
  });

  panel.onDidDispose(() => {
    themeListener.dispose();
  });

  context.subscriptions.push(panel);
}

function getWebviewHtml(mermaidCode: string, isDark: boolean): string {
  const theme = isDark ? 'dark' : 'default';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
  <style>
    body {
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      display: flex;
      justify-content: center;
      padding: 20px;
      margin: 0;
    }
  </style>
</head>
<body>
  <div class="mermaid">
${mermaidCode}
  </div>
  <script>mermaid.initialize({ theme: '${theme}', startOnLoad: true });</script>
</body>
</html>`;
}
