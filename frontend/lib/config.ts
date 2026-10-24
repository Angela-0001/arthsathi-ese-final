/**
 * ArthSathi — Dynamic API Configuration Manager
 *
 * Resolves the backend API URL based on the runtime environment so the
 * frontend works in local development, LAN testing, and production without
 * manual configuration changes:
 *
 *   - localhost / 127.0.0.1        → http://localhost:3001
 *   - LAN IP (192.168.x.x / 10.x.x.x) → http://<hostname>:3001
 *   - production domain             → process.env.NEXT_PUBLIC_API_URL
 *   - server-side rendering         → http://localhost:3001 (always)
 *
 * The resolved URL is validated as HTTP(S) and cached for the session
 * (singleton: computed once, then reused). An invalid resolution throws a
 * ConfigurationError with a descriptive message.
 *
 * Usage:
 *   import { getApiUrl } from '@/lib/config';
 *   const res = await fetch(`${getApiUrl()}/api/users`);
 */

/** Backend API port — single source of truth to avoid drift. */
const API_PORT = 3001;

/** Fallback URL used when no env var is available. */
const DEFAULT_API_URL = `http://localhost:${API_PORT}`;

/** Regexes that identify a private/LAN IPv4 address. */
const LAN_IP_PATTERNS: ReadonlyArray<RegExp> = [
  /^192\.168\.\d{1,3}\.\d{1,3}$/,
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
];

export type Environment = 'development' | 'staging' | 'production';

/**
 * Error raised when the resolved API URL is not a valid HTTP(S) URL.
 * Carries a descriptive message indicating what went wrong.
 */
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';

    // Restore the prototype chain (needed when targetting older ES versions
    // that transpile classes; harmless under native ES2017+ classes).
    Object.setPrototypeOf(this, ConfigurationError.prototype);
  }
}

/** Returns true when `hostname` is a private LAN IPv4 address. */
function isLanIp(hostname: string): boolean {
  return LAN_IP_PATTERNS.some((re) => re.test(hostname));
}

/**
 * Validates that `url` is a well-formed http(s) URL.
 * Uses the standard URL constructor and checks the protocol.
 */
function isValidHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Singleton that resolves and caches the backend API URL based on the
 * runtime environment. Use {@link ConfigManager.getInstance} to obtain the
 * shared instance, or the {@link getApiUrl} helper for brevity.
 */
export class ConfigManager {
  private static instance: ConfigManager | null = null;

  /** Cached API URL — null means "not yet resolved". */
  private apiUrl: string | null = null;

  /** Private constructor enforces the singleton pattern. */
  private constructor() {}

  /** Returns the shared singleton instance, creating it if necessary. */
  static getInstance(): ConfigManager {
    if (ConfigManager.instance === null) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  /** True when running in the browser (client-side), false during SSR. */
  isClient(): boolean {
    return typeof window !== 'undefined';
  }

  /**
   * Detects the runtime environment:
   *  - `development`: localhost / 127.0.0.1 (or SSR)
   *  - `staging`: LAN IP address
   *  - `production`: any other (public) hostname
   */
  getEnvironment(): Environment {
    if (!this.isClient()) return 'development';

    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') return 'development';
    if (isLanIp(host)) return 'staging';
    return 'production';
  }

  /**
   * Resolves and returns the backend API URL.
   *
   * The URL is computed once from the environment and cached for the rest of
   * the session. Subsequent calls return the cached value without
   * recomputation.
   *
   * @throws {ConfigurationError} if the resolved URL is not a valid HTTP(S) URL.
   */
  getApiUrl(): string {
    if (this.apiUrl !== null) return this.apiUrl;

    const resolved = this.resolveApiUrl();
    if (!isValidHttpUrl(resolved)) {
      throw new ConfigurationError(
        `Invalid API URL resolved: "${resolved}". ` +
          'Expected a valid http(s) URL (e.g. http://localhost:3001).'
      );
    }

    this.apiUrl = resolved;
    return this.apiUrl;
  }

  /**
   * Resolves the API URL based on the current environment.
   *
   * - SSR: always `http://localhost:3001`.
   * - localhost / 127.0.0.1: `http://localhost:3001`.
   * - LAN IP: `http://<hostname>:3001` (same host as the browser, so it can
   *   reach the backend on the local network).
   * - Production domain: `NEXT_PUBLIC_API_URL` env var, falling back to
   *   `http://localhost:3001`.
   */
  private resolveApiUrl(): string {
    // Server-side rendering: always point to localhost.
    if (!this.isClient()) {
      return DEFAULT_API_URL;
    }

    const host = window.location.hostname;

    // Local development.
    if (host === 'localhost' || host === '127.0.0.1') {
      return DEFAULT_API_URL;
    }

    // LAN IP — reuse the browser hostname so the device can reach the backend.
    if (isLanIp(host)) {
      return `http://${host}:${API_PORT}`;
    }

    // Production domain — rely on the build-time exposed env var.
    return process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_URL;
  }

  /**
   * Clears the cached URL so the next {@link getApiUrl} call re-resolves from
   * the current environment. Useful after a runtime environment change (e.g.
   * hostname change in tests) or to recover from a failed resolution.
   */
  refreshConfig(): void {
    this.apiUrl = null;
  }
}

/**
 * Convenience helper returning the resolved backend API URL from the shared
 * {@link ConfigManager} singleton.
 *
 * @throws {ConfigurationError} if the resolved URL is invalid.
 */
export function getApiUrl(): string {
  return ConfigManager.getInstance().getApiUrl();
}
