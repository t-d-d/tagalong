// Parameter Store and S3 in memory, behind the service's Aws interface.
import type { Aws } from "../service/src/aws.ts";

export interface FakeAws extends Aws {
  secrets: Map<string, string>;
  objects: Map<string, { body: Buffer; contentType: string }>;
  puts: string[];
}

export function fakeAws(): FakeAws {
  const secrets = new Map<string, string>();
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  const puts: string[] = [];
  return {
    secrets,
    objects,
    puts,
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
    deleteObject: (bucket, key) => {
      objects.delete(`${bucket}/${key}`);
      return Promise.resolve();
    },
  };
}
