// Parameter Store, S3 and Transcribe in memory, behind the service's Aws interface.
import type { Aws } from "../service/src/aws.ts";

export interface FakeAws extends Aws {
  secrets: Map<string, string>;
  objects: Map<string, { body: Buffer; contentType: string }>;
  puts: string[];
  /** What each voice note says, by its bytes; one not here fails to transcribe. */
  speech: Map<string, string>;
  /** The keys of the voice notes transcribed. */
  transcribed: string[];
}

export function fakeAws(): FakeAws {
  const secrets = new Map<string, string>();
  const objects = new Map<string, { body: Buffer; contentType: string }>();
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
      objects.set(`${bucket}/${key}`, { body, contentType });
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
    deleteObject: (bucket, key) => {
      objects.delete(`${bucket}/${key}`);
      return Promise.resolve();
    },
  };
}
