export interface CliArgs {
  command: string;
  configPath?: string;
  provider: string;
  fixture?: string;
}

export function parseArgs(argv: readonly string[]): CliArgs {
  const [command, configPath, ...rest] = argv;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    return { command: "help", provider: "mock" };
  }

  const parsed: CliArgs = configPath ? {
    command,
    configPath,
    provider: "mock",
  } : {
    command,
    provider: "mock",
  };

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = rest[index + 1];

    if (arg === "--provider" && next) {
      parsed.provider = next;
      index += 1;
      continue;
    }

    if (arg === "--fixture" && next) {
      parsed.fixture = next;
      index += 1;
    }
  }

  return parsed;
}
