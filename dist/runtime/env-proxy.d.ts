/** `NODE_USE_ENV_PROXY` exists from Node.js 24.0.0 and 22.21.0 (doc/api/cli.md). */
export declare function supportsEnvProxy(version?: string): boolean;
export interface EnvProxyContext {
    env?: NodeJS.ProcessEnv;
    execArgv?: readonly string[];
    version?: string;
}
/**
 * Whether this process should start again with Node.js env proxy support switched on.
 *
 * Node.js fetch ignores `HTTPS_PROXY` and friends unless `NODE_USE_ENV_PROXY=1` was set at
 * startup, and nothing can switch it on afterwards. curl, git and npm all honor those variables,
 * so a user whose shell routes them through a proxy reasonably expects this tool to follow; when
 * it does not, the request goes out directly and fails somewhere that says nothing about proxies.
 *
 * It declines whenever starting again could make things worse than going direct:
 * - `NODE_USE_ENV_PROXY` or `--use-env-proxy` is already present, either way. `0` is how a user
 *   opts out, and a value we set ourselves is how the restarted process knows not to loop.
 * - The runtime predates the switch, which would ignore it.
 * - Any proxy variable holds something other than an `http:` or `https:` URL. Node.js refuses to
 *   start at all once the switch is on and it meets, say, `socks5://` or a bare `host:port`.
 */
export declare function shouldRelaunchWithEnvProxy(context?: EnvProxyContext): boolean;
/**
 * Start this same program again with env proxy support on, pass its exit status through, and
 * never return.
 *
 * The child shares this process's stdin, stdout and stderr, so a user at a terminal and a script
 * piping JSON both reach it unchanged; this process only waits. Signals are forwarded so Ctrl-C
 * and a CI runner's SIGTERM reach the child.
 */
export declare function relaunchWithEnvProxy(): Promise<never>;
