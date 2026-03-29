import * as vscode from 'vscode';

export class WhizbangOutputChannel {
  private static instance: WhizbangOutputChannel;
  private channel: vscode.OutputChannel;

  private constructor() {
    this.channel = vscode.window.createOutputChannel('Whizbang');
  }

  static getInstance(): WhizbangOutputChannel {
    if (!WhizbangOutputChannel.instance) {
      WhizbangOutputChannel.instance = new WhizbangOutputChannel();
    }
    return WhizbangOutputChannel.instance;
  }

  raw(message: string): void {
    this.channel.appendLine(message);
  }

  log(message: string): void {
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    this.channel.appendLine(`[${timestamp}] ${message}`);
  }

  warn(message: string): void {
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    this.channel.appendLine(`[${timestamp}] ⚠️ ${message}`);
  }

  error(message: string, err?: Error): void {
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    this.channel.appendLine(`[${timestamp}] ❌ ${message}`);
    if (err?.stack) {
      this.channel.appendLine(`  ${err.stack}`);
    }
  }

  show(): void {
    this.channel.show(true); // true = preserve focus
  }

  dispose(): void {
    this.channel.dispose();
  }
}
