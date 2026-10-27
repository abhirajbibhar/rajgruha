/**
 * A tiny storage port over R2.
 *
 * The API only ever talks to this interface, which keeps R2 a single swappable
 * detail and (more usefully) lets the test suite run the real HTTP handlers in
 * plain Node against an in-memory implementation instead of needing a Workers
 * runtime to be present.
 */
export interface RangeSpec {
  offset: number;
  length?: number;
}

export interface StoredObject {
  /** Size of the whole object, not just the returned range. */
  readonly size: number;
  /** The range actually returned, when a range request was made. */
  readonly range: RangeSpec | null;
  /** When the object was last written, which is how the app knows a file is real. */
  readonly uploaded: Date | null;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
  stream(): ReadableStream | null;
}

export interface PutOptions {
  contentType?: string;
  contentDisposition?: string;
  cacheControl?: string;
}

export interface ListOptions {
  prefix: string;
  cursor?: string;
  limit?: number;
}

export interface ListResult {
  keys: { key: string; size: number }[];
  truncated: boolean;
  cursor?: string;
}

export interface ObjectStore {
  get(key: string, range?: RangeSpec): Promise<StoredObject | null>;
  head(key: string): Promise<{ size: number } | null>;
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string | ReadableStream,
    options?: PutOptions,
  ): Promise<void>;
  delete(keys: string | string[]): Promise<void>;
  list(options: ListOptions): Promise<ListResult>;
}

/** R2-backed store used in production. */
export function r2Store(bucket: R2Bucket): ObjectStore {
  return {
    async get(key, range) {
      const object = range
        ? await bucket.get(key, {
            range: range.length === undefined
              ? { offset: range.offset }
              : { offset: range.offset, length: range.length },
          })
        : await bucket.get(key);
      if (!object) return null;

      let returned: RangeSpec | null = null;
      if (range) {
        const objectRange = object.range as { offset?: number; length?: number; suffix?: number } | undefined;
        if (objectRange && typeof objectRange.offset === 'number') {
          returned = { offset: objectRange.offset, length: objectRange.length };
        } else {
          returned = range;
        }
      }

      return {
        size: object.size,
        range: returned,
        uploaded: object.uploaded ?? null,
        text: () => object.text(),
        arrayBuffer: () => object.arrayBuffer(),
        stream: () => object.body,
      };
    },

    async head(key) {
      const object = await bucket.head(key);
      return object ? { size: object.size } : null;
    },

    async put(key, value, options) {
      const httpMetadata = options
        ? {
            contentType: options.contentType,
            contentDisposition: options.contentDisposition,
            cacheControl: options.cacheControl,
          }
        : undefined;
      await bucket.put(key, value as Parameters<R2Bucket['put']>[1], httpMetadata ? { httpMetadata } : undefined);
    },

    async delete(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      if (list.length === 0) return;
      await bucket.delete(list);
    },

    async list(options) {
      const result = await bucket.list({
        prefix: options.prefix,
        cursor: options.cursor,
        limit: options.limit ?? 1000,
      });
      return {
        keys: result.objects.map((o) => ({ key: o.key, size: o.size })),
        truncated: result.truncated,
        cursor: result.truncated ? result.cursor : undefined,
      };
    },
  };
}

/** In-memory store used by the test suite. */
export function memoryStore(): ObjectStore & { snapshot(): Map<string, Uint8Array> } {
  const objects = new Map<string, { bytes: Uint8Array; contentType?: string; uploaded: Date }>();

  const slice = (bytes: Uint8Array, range?: RangeSpec) => {
    if (!range) return { bytes, returned: null as RangeSpec | null };
    const end = range.length === undefined ? bytes.byteLength : Math.min(bytes.byteLength, range.offset + range.length);
    const part = bytes.subarray(range.offset, end);
    return { bytes: part, returned: { offset: range.offset, length: part.byteLength } };
  };

  return {
    async get(key, range) {
      const stored = objects.get(key);
      if (!stored) return null;
      const { bytes, returned } = slice(stored.bytes, range);
      return {
        size: stored.bytes.byteLength,
        range: returned,
        uploaded: stored.uploaded,
        text: () => Promise.resolve(new TextDecoder().decode(bytes)),
        arrayBuffer: () => Promise.resolve(bytes.slice().buffer as ArrayBuffer),
        stream: () => new Blob([bytes.slice()]).stream() as ReadableStream,
      };
    },

    async head(key) {
      const stored = objects.get(key);
      return stored ? { size: stored.bytes.byteLength } : null;
    },

    async put(key, value, options) {
      let bytes: Uint8Array;
      if (typeof value === 'string') bytes = new TextEncoder().encode(value);
      else if (value instanceof ArrayBuffer) bytes = new Uint8Array(value);
      else if (ArrayBuffer.isView(value)) bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      else bytes = new Uint8Array(await new Response(value).arrayBuffer());
      objects.set(key, { bytes, contentType: options?.contentType, uploaded: new Date() });
    },

    async delete(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);
    },

    async list(options) {
      const all = [...objects.keys()].filter((key) => key.startsWith(options.prefix)).sort();
      const start = options.cursor ? Number(options.cursor) : 0;
      const limit = options.limit ?? 1000;
      const page = all.slice(start, start + limit);
      const next = start + page.length;
      const truncated = next < all.length;
      return {
        keys: page.map((key) => ({ key, size: objects.get(key)?.bytes.byteLength ?? 0 })),
        truncated,
        cursor: truncated ? String(next) : undefined,
      };
    },

    snapshot() {
      return new Map([...objects.entries()].map(([key, value]) => [key, value.bytes]));
    },
  };
}
