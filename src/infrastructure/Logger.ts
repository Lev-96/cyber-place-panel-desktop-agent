type Level = "debug" | "info" | "warn" | "error";
interface ILogger {
  debug(...a: unknown[]): void;
  info(...a: unknown[]): void;
  warn(...a: unknown[]): void;
  error(...a: unknown[]): void;
}

const noop = () => {};

class SilentLogger implements ILogger { debug = noop; info = noop; warn = noop; error = noop; }

class ConsoleLogger implements ILogger {
  private write(level: Level, args: unknown[]) {
    const fn = console[level] ?? console.log;
    fn.call(console, "[agent]", ...args);
  }
  debug(...a: unknown[]) { this.write("debug", a); }
  info(...a: unknown[]) { this.write("info", a); }
  warn(...a: unknown[]) { this.write("warn", a); }
  error(...a: unknown[]) { this.write("error", a); }
}

const isDev = import.meta.env.DEV === true;
export const logger: ILogger = isDev ? new ConsoleLogger() : new SilentLogger();
