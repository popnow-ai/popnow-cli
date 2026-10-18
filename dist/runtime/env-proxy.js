import { spawn } from "node:child_process";
/**
 * The variables Node.js reads for its built-in proxy support, in the order it reads them: the
 * lowercase spelling wins when both are set.
 */
const PROXY_VARIABLES = ["https_proxy", "HTTPS_PROXY", "http_proxy", "HTTP_PROXY"];
/**
 * Node.js prints this experimental-feature warning on every start with env proxy support on. On
 * a CLI that is a line of noise per command, and in a script a line in every log.
 */
const ENV_PROXY_WARNING = "--disable-warning=UNDICI-EHPA";
const FORWARDED_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"];
function isHttpProxyUrl(value) {
    try {
        const { protocol } = new URL(value);
        return protocol === "http:" || protocol === "https:";
    }
    catch {
        return false;
    }
}
/** `NODE_USE_ENV_PROXY` exists from Node.js 24.0.0 and 22.21.0 (doc/api/cli.md). */
export function supportsEnvProxy(version = process.versions.node) {
    const [major = 0, minor = 0] = version.split(".").map(Number);
    return major >= 24 || (major === 22 && minor >= 21);
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
export function shouldRelaunchWithEnvProxy(context = {}) {
    const env = context.env ?? process.env;
    const execArgv = context.execArgv ?? process.execArgv;
    if (env.NODE_USE_ENV_PROXY !== undefined)
        return false;
    if (execArgv.some((flag) => flag.includes("use-env-proxy")))
        return false;
    if ((env.NODE_OPTIONS ?? "").includes("use-env-proxy"))
        return false;
    if (!supportsEnvProxy(context.version))
        return false;
    const configured = PROXY_VARIABLES.map((name) => env[name] ?? "").filter((value) => value !== "");
    return configured.length > 0 && configured.every(isHttpProxyUrl);
}
/**
 * Start this same program again with env proxy support on, pass its exit status through, and
 * never return.
 *
 * The child shares this process's stdin, stdout and stderr, so a user at a terminal and a script
 * piping JSON both reach it unchanged; this process only waits. Signals are forwarded so Ctrl-C
 * and a CI runner's SIGTERM reach the child.
 */
export function relaunchWithEnvProxy() {
    const child = spawn(process.execPath, [ENV_PROXY_WARNING, ...process.execArgv, ...process.argv.slice(1)], { stdio: "inherit", env: { ...process.env, NODE_USE_ENV_PROXY: "1" } });
    const forwarders = FORWARDED_SIGNALS.map((signal) => {
        const forward = () => {
            child.kill(signal);
        };
        process.on(signal, forward);
        return [signal, forward];
    });
    const stopForwarding = () => {
        for (const [signal, forward] of forwarders)
            process.off(signal, forward);
    };
    return new Promise(() => {
        child.once("error", (error) => {
            stopForwarding();
            console.error(`could not restart with proxy support: ${error.message}`);
            process.exit(1);
        });
        child.once("exit", (code, signal) => {
            stopForwarding();
            // Dying of the same signal keeps the shell's view of what happened (130 for Ctrl+C).
            if (signal !== null)
                process.kill(process.pid, signal);
            else
                process.exit(code ?? 1);
        });
    });
}
