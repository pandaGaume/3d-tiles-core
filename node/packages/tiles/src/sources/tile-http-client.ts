/** Fetch function compatible with `globalThis.fetch`. */
export type FetchFunction = (input: string, init?: RequestInit) => Promise<Response>;

/** Options of {@link TileHttpClient}. */
export interface ITileHttpClientOptions {
    /** Defaults to `globalThis.fetch`. */
    fetch?: FetchFunction;
    /** Headers sent with every request, for example an `Authorization` header. */
    headers?: Readonly<Record<string, string>>;
    /** Total number of attempts, including the first one. Defaults to 4. */
    maxAttempts?: number;
    /** Base delay of the exponential backoff in milliseconds. Defaults to 500. */
    initialDelayMs?: number;
    /** Upper bound of a single delay in milliseconds, including `Retry-After`. Defaults to 30,000. */
    maxDelayMs?: number;
    /** HTTP statuses retried with backoff. Defaults to 408, 425, 429, 500, 502, 503 and 504. */
    retryStatuses?: readonly number[];
    /** HTTP statuses meaning that the tile does not exist. Defaults to 204 and 404. */
    absentStatuses?: readonly number[];
    /** Random source in `[0, 1)` for the jitter. Defaults to `Math.random`. */
    random?: () => number;
    /** Waits for a delay, rejecting when the signal aborts. Replaceable for tests. */
    sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

/** Outcome of a tile request. A tile known to be missing is a result, not an error. */
export type TileFetchResult = { status: "ok"; url: string; bytes: Uint8Array; contentType: string | undefined } | { status: "absent"; url: string; httpStatus: number };

/** Raised when a tile request fails permanently or exhausts its attempts. */
export class TileHttpError extends Error {
    public constructor(
        message: string,
        public readonly url: string,
        public readonly attempts: number,
        public readonly httpStatus?: number,
        options?: ErrorOptions
    ) {
        super(message, options);
        this.name = "TileHttpError";
    }
}

function abortReason(signal: AbortSignal): unknown {
    return signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}

function defaultSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(abortReason(signal));
            return;
        }
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, milliseconds);
        const onAbort = (): void => {
            clearTimeout(timer);
            reject(abortReason(signal!));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

/** Parses a `Retry-After` header expressed in seconds or as an HTTP date. */
function retryAfterMs(response: Response): number | undefined {
    const value = response.headers.get("retry-after");
    if (value === null) return undefined;
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(value);
    return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

/**
 * HTTP client for tile requests.
 *
 * - Statuses listed in `absentStatuses` resolve to `{ status: "absent" }`, so sparse pyramids need no error handling.
 * - Network errors and statuses listed in `retryStatuses` are retried with exponential backoff and jitter:
 *   `min(maxDelayMs, initialDelayMs * 2^(attempt - 1)) + random() * initialDelayMs`, or `Retry-After` when present.
 * - Any other status fails immediately with a {@link TileHttpError}.
 * - Aborting the signal rejects with the abort reason, including during a backoff delay.
 */
export class TileHttpClient {
    private readonly fetchFunction: FetchFunction;
    private readonly headers: Readonly<Record<string, string>>;
    private readonly maxAttempts: number;
    private readonly initialDelayMs: number;
    private readonly maxDelayMs: number;
    private readonly retryStatuses: ReadonlySet<number>;
    private readonly absentStatuses: ReadonlySet<number>;
    private readonly random: () => number;
    private readonly sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;

    public constructor(options: ITileHttpClientOptions = {}) {
        if (!options.fetch && typeof globalThis.fetch !== "function") throw new TypeError("No fetch implementation is available; supply options.fetch.");
        // Browsers require fetch to be called on the global object, so the default is bound to it.
        this.fetchFunction = options.fetch ?? globalThis.fetch.bind(globalThis);
        this.headers = { ...(options.headers ?? {}) };
        this.maxAttempts = options.maxAttempts ?? 4;
        this.initialDelayMs = options.initialDelayMs ?? 500;
        this.maxDelayMs = options.maxDelayMs ?? 30_000;
        this.retryStatuses = new Set(options.retryStatuses ?? [408, 425, 429, 500, 502, 503, 504]);
        this.absentStatuses = new Set(options.absentStatuses ?? [204, 404]);
        this.random = options.random ?? Math.random;
        this.sleep = options.sleep ?? defaultSleep;
        if (!Number.isInteger(this.maxAttempts) || this.maxAttempts < 1) throw new RangeError("maxAttempts must be a positive integer.");
        if (!(this.initialDelayMs >= 0) || !(this.maxDelayMs >= 0)) throw new RangeError("Backoff delays must be non-negative.");
    }

    /**
     * Fetches one tile.
     *
     * @param url - Expanded tile URL.
     * @param signal - Optional abort signal.
     * @returns The tile bytes, or an `absent` result.
     * @throws TileHttpError When the request fails permanently or exhausts its attempts.
     */
    public async fetchTile(url: string, signal?: AbortSignal): Promise<TileFetchResult> {
        let lastError: unknown;
        let lastStatus: number | undefined;
        for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
            if (signal?.aborted) throw abortReason(signal);
            let retryDelay: number | undefined;
            try {
                const response = await this.fetchFunction(url, { headers: this.headers, ...(signal ? { signal } : {}) });
                if (response.ok && response.status !== 204) {
                    const bytes = new Uint8Array(await response.arrayBuffer());
                    return { status: "ok", url, bytes, contentType: response.headers.get("content-type") ?? undefined };
                }
                if (this.absentStatuses.has(response.status)) return { status: "absent", url, httpStatus: response.status };
                if (!this.retryStatuses.has(response.status)) {
                    throw new TileHttpError(`Tile request failed with HTTP ${response.status}: ${url}`, url, attempt, response.status);
                }
                lastStatus = response.status;
                lastError = undefined;
                retryDelay = retryAfterMs(response);
            } catch (error) {
                if (error instanceof TileHttpError) throw error;
                if (signal?.aborted) throw abortReason(signal);
                lastError = error;
                lastStatus = undefined;
            }
            if (attempt < this.maxAttempts) {
                const backoff = Math.min(this.maxDelayMs, this.initialDelayMs * 2 ** (attempt - 1)) + this.random() * this.initialDelayMs;
                await this.sleep(Math.min(this.maxDelayMs, retryDelay ?? backoff), signal);
            }
        }
        const reason = lastStatus === undefined ? "a network error" : `HTTP ${lastStatus}`;
        throw new TileHttpError(`Tile request failed after ${this.maxAttempts} attempts with ${reason}: ${url}`, url, this.maxAttempts, lastStatus, {
            cause: lastError,
        });
    }
}
