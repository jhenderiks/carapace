import type { RtkConfig } from "./types.js";

const DEFAULT_COMMANDS = {
  allIntercept: [
    "ls",
    "tree",
    "curl",
    "wc",
    "diff",
    "env",
    "wget",
    "prettier",
    "prisma",
    "tsc",
    "vitest",
    "pytest",
    "mypy",
    "ruff",
    "playwright",
    "pip",
    "golangci-lint",
  ] as const,
  selective: {
    git: ["status", "diff", "log", "add", "push", "pull", "branch", "fetch", "stash", "show"],
    gh: ["pr", "issue", "run", "api", "release"],
    npm: ["test", "run"],
    npx: ["vitest", "vue-tsc", "tsc", "eslint", "prettier", "playwright", "prisma"],
    pnpm: ["test", "tsc", "lint", "playwright", "list", "ls", "outdated"],
    cargo: ["test", "build", "clippy", "check"],
    docker: ["ps", "images", "logs", "inspect"],
    go: ["test", "build", "vet"],
    next: ["dev", "build"],
  } as const,
  remapped: {
    cat: "read",
    head: "read",
    grep: "grep",
    rg: "grep",
    eslint: "lint",
  },
  skip: ["gh api"],
} as const;

export const DEFAULT_RTK_CONFIG: RtkConfig = {
  enabled: true,
  binary: "/usr/local/bin/rtk",
  allIntercept: [...DEFAULT_COMMANDS.allIntercept],
  selective: {
    git: [...DEFAULT_COMMANDS.selective.git],
    gh: [...DEFAULT_COMMANDS.selective.gh],
    npm: [...DEFAULT_COMMANDS.selective.npm],
    npx: [...DEFAULT_COMMANDS.selective.npx],
    pnpm: [...DEFAULT_COMMANDS.selective.pnpm],
    cargo: [...DEFAULT_COMMANDS.selective.cargo],
    docker: [...DEFAULT_COMMANDS.selective.docker],
    go: [...DEFAULT_COMMANDS.selective.go],
    next: [...DEFAULT_COMMANDS.selective.next],
  },
  remapped: {
    ...DEFAULT_COMMANDS.remapped,
  },
  skip: [...DEFAULT_COMMANDS.skip],
};

export function normalizeRtkConfig(rawConfig: unknown): RtkConfig {
  const config = (rawConfig as Partial<RtkConfig>) ?? {};

  return {
    enabled: typeof config.enabled === "boolean" ? config.enabled : DEFAULT_RTK_CONFIG.enabled,
    binary: typeof config.binary === "string" && config.binary.length > 0
      ? config.binary
      : DEFAULT_RTK_CONFIG.binary,
    allIntercept: normalizeStringArray(config.allIntercept, DEFAULT_RTK_CONFIG.allIntercept),
    selective: normalizeSelectiveConfig(config.selective),
    remapped: normalizeStringRecord(config.remapped, DEFAULT_RTK_CONFIG.remapped),
    skip: normalizeStringArray(config.skip, DEFAULT_RTK_CONFIG.skip),
  };
}

function normalizeStringArray(
  value: unknown,
  fallback: string[],
): string[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function normalizeSelectiveConfig(
  value: unknown,
): Record<string, string[]> {
  const next: Record<string, string[]> = {
    ...DEFAULT_RTK_CONFIG.selective,
  };

  if (!value || typeof value !== "object") {
    return next;
  }

  for (const [command, entries] of Object.entries(value)) {
    if (!Array.isArray(entries)) {
      continue;
    }

    next[command] = entries
      .filter((entry): entry is string => typeof entry === "string")
      .filter((entry) => entry.length > 0);
  }

  return next;
}

function normalizeStringRecord(
  value: unknown,
  fallback: Record<string, string>,
): Record<string, string> {
  const next: Record<string, string> = { ...fallback };

  if (!value || typeof value !== "object") {
    return next;
  }

  for (const [key, replacement] of Object.entries(value)) {
    if (typeof replacement === "string" && replacement.length > 0) {
      next[key] = replacement;
    }
  }

  return next;
}

function splitCommand(command: string): string[] {
  const tokens: string[] = [];
  let token = "";
  let quote: "single" | "double" | null = null;
  let escaped = false;

  for (let i = 0; i < command.length; i += 1) {
    const char = command[i];

    if (escaped) {
      token += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      token += char;
      escaped = true;
      continue;
    }

    if (quote === null) {
      if (char === "'") {
        quote = "single";
        token += char;
        continue;
      }

      if (char === '"') {
        quote = "double";
        token += char;
        continue;
      }

      if (char === "|") {
        break;
      }

      if (/\s/.test(char)) {
        if (token.length > 0) {
          tokens.push(token);
          token = "";
        }

        continue;
      }

      token += char;
      continue;
    }

    if (quote === "single") {
      token += char;
      if (char === "'") {
        quote = null;
      }
      continue;
    }

    if (quote === "double") {
      token += char;
      if (char === '"') {
        quote = null;
      }
      continue;
    }
  }

  if (token.length > 0) {
    tokens.push(token);
  }

  return tokens;
}

function firstUnquotedPipe(command: string): number | null {
  let quote: "single" | "double" | null = null;
  let escaped = false;

  for (let i = 0; i < command.length; i += 1) {
    const char = command[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (quote === null) {
      if (char === "'") {
        quote = "single";
        continue;
      }

      if (char === '"') {
        quote = "double";
        continue;
      }

      if (char === "|") {
        return i;
      }

      continue;
    }

    if (quote === "single") {
      if (char === "'") {
        quote = null;
      }

      continue;
    }

    if (quote === "double") {
      if (char === '"') {
        quote = null;
      }

      continue;
    }
  }

  return null;
}

function hasUnquotedHeredoc(command: string): boolean {
  let quote: "single" | "double" | null = null;
  let escaped = false;

  for (let i = 0; i < command.length - 1; i += 1) {
    const char = command[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (quote === null) {
      if (char === "'") {
        quote = "single";
        continue;
      }

      if (char === '"') {
        quote = "double";
        continue;
      }

      if (char === "<" && command[i + 1] === "<") {
        return true;
      }

      continue;
    }

    if (quote === "single") {
      if (char === "'") {
        quote = null;
      }

      continue;
    }

    if (quote === "double") {
      if (char === '"') {
        quote = null;
      }

      continue;
    }
  }

  return false;
}

function isEnvAssignment(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s]+)$/.test(token);
}

function splitCommandAndEnv(command: string): {
  env: string[];
  command: string;
  args: string[];
} {
  const tokens = splitCommand(command);
  let index = 0;
  const env: string[] = [];

  while (index < tokens.length && isEnvAssignment(tokens[index]!)) {
    env.push(tokens[index]!);
    index += 1;
  }

  if (index >= tokens.length) {
    return { env: env, command: "", args: [] };
  }

  return {
    env,
    command: tokens[index]!,
    args: tokens.slice(index + 1),
  };
}

function shouldSkipCommand(command: string, config: RtkConfig): boolean {
  const normalized = command.trim();

  return config.skip.some((skipPattern) => {
    const pattern = String(skipPattern).trim();
    return (
      normalized === pattern ||
      normalized.startsWith(`${pattern} `)
    );
  });
}

function parseGrepArgs(args: string[], supportsRegexTranslation: boolean): {
  pattern: string;
  path?: string;
  flags: string[];
} | null {
  if (args.length === 0) {
    return null;
  }

  for (const arg of args) {
    if (
      arg === "-c" ||
      arg === "--count" ||
      arg === "-l" ||
      arg === "--files-with-matches" ||
      arg === "-e" ||
      arg === "--regexp"
    ) {
      return null;
    }

    if (/^-[^\s]*[cl]/.test(arg)) {
      return null;
    }
  }

  const flags: string[] = [];
  let expectingValueFor: string | null = null;
  let pattern: string | undefined;
  let path: string | undefined;

  for (const arg of args) {
    if (expectingValueFor !== null) {
      flags.push(expectingValueFor, arg);
      expectingValueFor = null;
      continue;
    }

    if (pattern === undefined) {
      if (
        arg === "-A" ||
        arg === "-B" ||
        arg === "-C" ||
        arg === "-m" ||
        arg === "--after-context" ||
        arg === "--before-context" ||
        arg === "--context" ||
        arg === "--max-count"
      ) {
        expectingValueFor = arg;
        continue;
      }

      if (/^-[ABC][0-9]+$/.test(arg)) {
        flags.push(arg);
        continue;
      }

      if (arg === "-v") {
        flags.push("--invert-match");
        continue;
      }

      if (arg === "-o") {
        flags.push("--only-matching");
        continue;
      }

      if (
        supportsRegexTranslation &&
        (arg === "-E" ||
          arg === "--extended-regexp" ||
          arg === "-G" ||
          arg === "--basic-regexp")
      ) {
        continue;
      }

      if (arg === "-F" || arg === "--fixed-strings") {
        flags.push("-F");
        continue;
      }

      if (arg === "-P" || arg === "--perl-regexp") {
        flags.push("-P");
        continue;
      }

      if (arg === "-w" || arg === "--word-regexp") {
        flags.push("-w");
        continue;
      }

      if (arg.startsWith("-")) {
        flags.push(arg);
        continue;
      }

      pattern = arg;
      continue;
    }

    if (path === undefined && arg.startsWith("-") === false) {
      path = arg;
      continue;
    }

    flags.push(arg);
  }

  if (pattern === undefined) {
    return null;
  }

  return { pattern, path, flags };
}

function rewriteHeadCommand(
  args: string[],
  binary: string,
): string | null {
  if (args.length === 0) {
    return null;
  }

  if (/^-[0-9]+$/.test(args[0] ?? "") && args.length >= 2) {
    const lines = args[0]!.slice(1);
    const rest = args.slice(1).join(" ");
    return `${binary} read ${rest} --max-lines ${lines}`;
  }

  if (args[0] === "-n" && args.length >= 3) {
    const lines = args[1] ?? "";
    const rest = args.slice(2).join(" ");
    return `${binary} read ${rest} --max-lines ${lines}`;
  }

  if (args[0]?.startsWith("--lines=") && args[0]?.includes("=") && args.length >= 2) {
    const lines = args[0].slice("--lines=".length);
    const rest = args.slice(1).join(" ");
    return `${binary} read ${rest} --max-lines ${lines}`;
  }

  return null;
}

function rewriteGrepOrRg(
  binary: string,
  command: string,
  args: string[],
): string | null {
  const parsed = parseGrepArgs(args, command === "grep");

  if (parsed === null) {
    return null;
  }

  const parts: string[] = [binary, "grep", parsed.pattern];

  if (parsed.path !== undefined) {
    parts.push(parsed.path);
  } else {
    parts.push(".");
  }

  if (parsed.flags.length > 0) {
    parts.push(...parsed.flags);
  }

  return parts.join(" ");
}

function rewriteByCommand(
  command: string,
  args: string[],
  config: RtkConfig,
): string | null {
  switch (command) {
    case "cat":
      if (args.length === 0) {
        return null;
      }

      return `${config.binary} read ${args.join(" ")}`;

    case "head":
      return rewriteHeadCommand(args, config.binary);

    case "grep":
    case "rg":
      return rewriteGrepOrRg(config.binary, command, args);

    case "git": {
      if (args.length === 0) {
        return null;
      }

      const subcommand = args[0];
      if (subcommand === "commit") {
        for (const arg of args.slice(1)) {
          if (arg === "-m" || arg === "--message" || arg === "commit") {
            continue;
          }

          if (arg.startsWith("-")) {
            return null;
          }
        }

        return `${config.binary} git ${args.join(" ")}`;
      }

      if (config.selective.git.includes(subcommand)) {
        return `${config.binary} git ${args.join(" ")}`;
      }

      return null;
    }

    case "gh": {
      const subcommand = args[0];
      if (subcommand && config.selective.gh.includes(subcommand)) {
        return `${config.binary} gh ${args.join(" ")}`;
      }

      return null;
    }

    case "npm": {
      const subcommand = args[0];
      if (!subcommand) {
        return null;
      }

      if (subcommand === "test") {
        return `${config.binary} npm ${args.join(" ")}`;
      }

      if (subcommand === "run") {
        return `${config.binary} npm ${args.slice(1).join(" ")}`;
      }

      return null;
    }

    case "npx": {
      const subcommand = args[0];
      if (!subcommand || !config.selective.npx.includes(subcommand)) {
        return null;
      }

      if (subcommand === "vitest") {
        return `${config.binary} vitest run ${args.slice(1).join(" ")}`;
      }

      if (subcommand === "vue-tsc" || subcommand === "tsc") {
        return `${config.binary} tsc ${args.slice(1).join(" ")}`;
      }

      if (subcommand === "eslint") {
        return `${config.binary} lint ${args.slice(1).join(" ")}`;
      }

      if (subcommand === "prettier") {
        return `${config.binary} prettier ${args.slice(1).join(" ")}`;
      }

      if (subcommand === "playwright") {
        return `${config.binary} playwright ${args.slice(1).join(" ")}`;
      }

      if (subcommand === "prisma") {
        return `${config.binary} prisma ${args.slice(1).join(" ")}`;
      }

      return null;
    }

    case "pnpm": {
      const subcommand = args[0];
      if (!subcommand || !config.selective.pnpm.includes(subcommand)) {
        return null;
      }

      if (subcommand === "test") {
        return `${config.binary} vitest run ${args.slice(1).join(" ")}`;
      }

      if (subcommand === "tsc") {
        return `${config.binary} tsc ${args.slice(1).join(" ")}`;
      }

      if (subcommand === "lint") {
        return `${config.binary} lint ${args.slice(1).join(" ")}`;
      }

      if (subcommand === "playwright") {
        return `${config.binary} playwright ${args.slice(1).join(" ")}`;
      }

      return `${config.binary} pnpm ${args.join(" ")}`;
    }

    case "cargo": {
      const subcommand = args[0];
      if (subcommand && config.selective.cargo.includes(subcommand)) {
        return `${config.binary} cargo ${args.join(" ")}`;
      }

      return null;
    }

    case "docker": {
      const subcommand = args[0];
      if (subcommand && config.selective.docker.includes(subcommand)) {
        return `${config.binary} docker ${args.join(" ")}`;
      }

      return null;
    }

    case "go": {
      const subcommand = args[0];
      if (subcommand && config.selective.go.includes(subcommand)) {
        return `${config.binary} go ${args.join(" ")}`;
      }

      return null;
    }

    case "find": {
      if (args.length === 0) {
        return null;
      }

      const first = args[0]!;
      if (first.startsWith("-") || first.startsWith("/") || first === ".") {
        return null;
      }

      return `${config.binary} find ${args.join(" ")}`;
    }

    case "next": {
      const subcommand = args[0];
      if (subcommand && config.selective.next.includes(subcommand)) {
        return `${config.binary} next ${args.join(" ")}`;
      }

      return null;
    }

    default:
      return null;
  }
}

function shouldRewriteFirst(command: string, config: RtkConfig): boolean {
  return config.allIntercept.includes(command);
}

function applyOnFirstPart(command: string, config: RtkConfig): string | null {
  const { env, command: baseCommand, args } = splitCommandAndEnv(command);

  if (baseCommand.length === 0) {
    return null;
  }

  if (baseCommand === "rtk") {
    return null;
  }

  const commandString = [baseCommand, ...args].join(" ").trim();

  if (shouldSkipCommand(commandString, config)) {
    return null;
  }

  const envPrefix = env.length > 0 ? `${env.join(" ")} ` : "";

  const mapped = config.remapped[baseCommand];
  if (mapped) {
    const rewritten = rewriteByCommand(baseCommand, args, config);
    if (rewritten !== null) {
      return `${envPrefix}${rewritten}`;
    }

    if (
      baseCommand === "cat" ||
      baseCommand === "head" ||
      baseCommand === "grep" ||
      baseCommand === "rg"
    ) {
      return null;
    }

    if (args.length > 0) {
      return `${envPrefix}${config.binary} ${mapped} ${args.join(" ")}`;
    }

    return `${envPrefix}${config.binary} ${mapped}`;
  }

  if (shouldRewriteFirst(baseCommand, config)) {
    if (args.length > 0) {
      return `${envPrefix}${config.binary} ${baseCommand} ${args.join(" ")}`;
    }

    return `${envPrefix}${config.binary} ${baseCommand}`;
  }

  const rewritten = rewriteByCommand(baseCommand, args, config);

  if (rewritten === null) {
    return null;
  }

  return `${envPrefix}${rewritten}`;
}

export function applyRtkRouting(command: string, config: RtkConfig): string | null {
  if (!config.enabled) {
    return null;
  }

  if (typeof command !== "string") {
    return null;
  }

  if (hasUnquotedHeredoc(command)) {
    return null;
  }

  const pipeIndex = firstUnquotedPipe(command);

  if (pipeIndex === null) {
    return applyOnFirstPart(command, config);
  }

  const firstCommand = command.slice(0, pipeIndex).trim();
  const rest = command.slice(pipeIndex);

  if (!firstCommand.length) {
    return null;
  }

  const rewritten = applyOnFirstPart(firstCommand, config);
  if (rewritten === null) {
    return null;
  }

  return `${rewritten} ${rest}`;
}
