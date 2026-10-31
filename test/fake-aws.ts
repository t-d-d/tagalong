// Parameter Store, S3 and Transcribe in memory, behind the service's Aws interface.
import type { Aws } from "../service/src/aws.ts";

/** An object in the fake bucket; `at` is when it was written, if known. */
export interface FakeObject {
  body: Buffer;
  contentType: string;
  at?: number;
}

export interface FakeAws extends Aws {
  secrets: Map<string, string>;
  objects: Map<string, FakeObject>;
  puts: string[];
  /** What each voice note says, by its bytes; one not here fails to transcribe. */
  speech: Map<string, string>;
  /** The keys of the voice notes transcribed. */
  transcribed: string[];
}

/** `now` stamps each object written, as S3's LastModified. */
export function fakeAws(now: () => number = () => Date.now()): FakeAws {
  const secrets = new Map<string, string>();
  const objects = new Map<string, FakeObject>();
  const puts: string[] = [];
  const speech = new Map<string, string>();
  const transcribed: string[] = [];
  return {
    secrets,
    objects,
    puts,
    speech,
    transcribed,
    getSecret: (name) => Promise.resolve(secrets.get(name)),
    putSecret: (name, value) => {
      secrets.set(name, value);
      puts.push(name);
      return Promise.resolve();
    },
    putObject: (bucket, key, body, contentType) => {
      objects.set(`${bucket}/${key}`, { body, contentType, at: now() });
      return Promise.resolve();
    },
    presign: (bucket, key, seconds) =>
      Promise.resolve(
        `https://${bucket}.s3.example.test/${key}?expires=${String(seconds)}`,
      ),
    getObject: (bucket, key) =>
      Promise.resolve(objects.get(`${bucket}/${key}`)?.body),
    transcribe: (bucket, key) => {
      transcribed.push(key);
      const body = objects.get(`${bucket}/${key}`)?.body.toString();
      const text = body === undefined ? undefined : speech.get(body);
      return text === undefined
        ? Promise.reject(new Error("transcription failed"))
        : Promise.resolve(text);
    },
    presignPut: (bucket, key, seconds) =>
      Promise.resolve(
        `https://${bucket}.s3.example.test/${key}?put=${String(seconds)}`,
      ),
    modifiedAt: (bucket, key) => {
      const object = objects.get(`${bucket}/${key}`);
      return Promise.resolve(
        object === undefined ? undefined : (object.at ?? now()),
      );
    },
    listObjects: (bucket, prefix) =>
      Promise.resolve(
        [...objects.entries()]
          .filter(([path]) => path.startsWith(`${bucket}/${prefix}`))
          .map(([path, object]) => ({
            key: path.slice(bucket.length + 1),
            bytes: object.body.length,
          })),
      ),
    deleteObject: (bucket, key) => {
      objects.delete(`${bucket}/${key}`);
      return Promise.resolve();
    },
  };
}
