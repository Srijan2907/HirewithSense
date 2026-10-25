import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';

export interface StoredFile {
  key: string;
  sizeBytes: number;
}

export interface Storage {
  put(buffer: Buffer, opts: { prefix: string; ext: string; contentType: string }): Promise<StoredFile>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

class LocalStorage implements Storage {
  constructor(private readonly root: string) {}
  private resolve(key: string) {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(path.resolve(this.root) + path.sep)) throw new Error('Invalid storage key');
    return p;
  }
  async put(buffer: Buffer, opts: { prefix: string; ext: string }): Promise<StoredFile> {
    const key = path.posix.join(opts.prefix, `${randomUUID()}.${opts.ext.replace(/^\./, '')}`);
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, buffer, { mode: 0o600 });
    return { key, sizeBytes: buffer.byteLength };
  }
  get(key: string) {
    return fs.readFile(this.resolve(key));
  }
  async delete(key: string) {
    await fs.rm(this.resolve(key), { force: true });
  }
}

class S3Storage implements Storage {
  private clientPromise: Promise<any> | null = null;
  private async client() {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const e = env();
        // Optional dependency: only needed when STORAGE_DRIVER=s3.
        const mod = await import(/* @vite-ignore */ '@aws-sdk/client-s3' as string);
        return new mod.S3Client({
          region: e.S3_REGION,
          endpoint: e.S3_ENDPOINT,
          forcePathStyle: e.S3_FORCE_PATH_STYLE,
          credentials: e.S3_ACCESS_KEY_ID ? { accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY! } : undefined,
        });
      })();
    }
    return this.clientPromise;
  }
  async put(buffer: Buffer, opts: { prefix: string; ext: string; contentType: string }): Promise<StoredFile> {
    const { PutObjectCommand } = await import(/* @vite-ignore */ '@aws-sdk/client-s3' as string);
    const key = `${opts.prefix}/${randomUUID()}.${opts.ext.replace(/^\./, '')}`;
    await (await this.client()).send(new PutObjectCommand({ Bucket: env().S3_BUCKET, Key: key, Body: buffer, ContentType: opts.contentType }));
    return { key, sizeBytes: buffer.byteLength };
  }
  async get(key: string): Promise<Buffer> {
    const { GetObjectCommand } = await import(/* @vite-ignore */ '@aws-sdk/client-s3' as string);
    const res = await (await this.client()).send(new GetObjectCommand({ Bucket: env().S3_BUCKET, Key: key }));
    return Buffer.from(await res.Body.transformToByteArray());
  }
  async delete(key: string): Promise<void> {
    const { DeleteObjectCommand } = await import(/* @vite-ignore */ '@aws-sdk/client-s3' as string);
    await (await this.client()).send(new DeleteObjectCommand({ Bucket: env().S3_BUCKET, Key: key }));
  }
}

let storage: Storage | null = null;
export function getStorage(): Storage {
  if (!storage) {
    const e = env();
    storage = e.STORAGE_DRIVER === 's3' ? new S3Storage() : new LocalStorage(path.resolve(e.UPLOAD_DIR));
  }
  return storage;
}
