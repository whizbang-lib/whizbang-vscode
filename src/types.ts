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

export interface MessageRegistry {
  messages: MessageInfo[];
}
