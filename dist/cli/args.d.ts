export interface CliArgs {
    command: string;
    configPath?: string;
    provider: string;
    fixture?: string;
}
export declare function parseArgs(argv: readonly string[]): CliArgs;
