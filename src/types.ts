// Type definitions for Whizbang message registry

export interface TestInfo {
  testFile: string;
  testMethod: string;
  testLine: number;
  testClass: string;
}

export interface CodeLocation {
  class: string;
  method: string;
  filePath: string;
  lineNumber: number;
  tests: TestInfo[];
}

export interface MessageInfo {
  type: string;
  isCommand: boolean;
  isEvent: boolean;
  filePath: string;
  lineNumber: number;
  docsUrl: string;
  tests: TestInfo[];
  dispatchers: CodeLocation[];
  receptors: CodeLocation[];
  perspectives: CodeLocation[];
}

export interface WhizbangPackageRef {
  id: string;
  versionPrefix: string;
}

export interface MessageRegistry {
  messages: MessageInfo[];
  whizbangPackages?: WhizbangPackageRef[];
}

// LSP response types (match C# Protocol/CustomParams.cs)

export interface SearchResult {
  title: string;
  category: string;
  slug: string;
  preview: string;
  score: number;
}

export interface SymbolInfo {
  name: string;
  kind: string;
  docsUrl?: string;
  docsTitle?: string;
  sourceFile?: string;
  sourceLine?: number;
  testCount: number;
  isCommand: boolean;
  isEvent: boolean;
  dispatcherCount: number;
  receptorCount: number;
  perspectiveCount: number;
}

export interface TestEntry {
  testFile: string;
  testMethod: string;
  testClass?: string;
  linkSource?: string;
}

export interface StatusInfo {
  messageCount: number;
  commandCount: number;
  eventCount: number;
  typeDocCount: number;
  testCount: number;
  cacheAgeMinutes: number;
  serverUptime?: string;
  isDebugPaused: boolean;
}
