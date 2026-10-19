// The one module that reaches AWS (types-and-lint.md).
import { randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  DeleteTranscriptionJobCommand,
  GetTranscriptionJobCommand,
  StartTranscriptionJobCommand,
  TranscribeClient,
} from "@aws-sdk/client-transcribe";
import {
  GetParameterCommand,
  PutParameterCommand,
  SSMClient,
} from "@aws-sdk/client-ssm";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";

/** How long a voice note may take to transcribe, and how often to look. */
export const TRANSCRIBE = { timeoutMs: 60_000, pollMs: 2_000 } as const;

// Transcribe's output file, the part read.
const transcriptSchema = z.object({
  results: z.object({
    transcripts: z.array(z.object({ transcript: z.string() })),
  }),
});

export class TranscribeFailed extends Error {
  override name = "TranscribeFailed";
}
export class TranscribeTimedOut extends Error {
  override name = "TranscribeTimedOut";
}

export interface Aws {
  /** A SecureString's value, decrypted. */
  getSecret(name: string): Promise<string | undefined>;
  putSecret(name: string, value: string): Promise<void>;
  putObject(
    bucket: string,
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<void>;
  /** A link anyone holding it can GET for `seconds` (attachments.md). */
  presign(bucket: string, key: string, seconds: number): Promise<string>;
  /** An object's bytes, or undefined when there is none. */
  getObject(bucket: string, key: string): Promise<Buffer | undefined>;
  deleteObject(bucket: string, key: string): Promise<void>;
  /**
   * What the voice note at `key` says, by Amazon Transcribe. Its output goes
   * beside it in the bucket, and the job is deleted once read (attachments.md).
   */
  transcribe(bucket: string, key: string): Promise<string>;
}

export function realAws(region: string | undefined): Aws {
  const config = region === undefined ? {} : { region };
  const ssm = new SSMClient(config);
  const s3 = new S3Client(config);
  const transcribe = new TranscribeClient(config);
  const getObject = async (bucket: string, key: string) => {
    try {
      const result = await s3.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      );
      return result.Body === undefined
        ? undefined
        : Buffer.from(await result.Body.transformToByteArray());
    } catch (error) {
      if (error instanceof NoSuchKey) return undefined;
      throw error;
    }
  };
  return {
    async getSecret(name) {
      const result = await ssm.send(
        new GetParameterCommand({ Name: name, WithDecryption: true }),
      );
      return result.Parameter?.Value;
    },
    async putSecret(name, value) {
      await ssm.send(
        new PutParameterCommand({
          Name: name,
          Value: value,
          Type: "SecureString",
          Overwrite: true,
        }),
      );
    },
    async putObject(bucket, key, body, contentType) {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
    },
    async presign(bucket, key, seconds) {
      return getSignedUrl(
        s3,
        new GetObjectCommand({ Bucket: bucket, Key: key }),
        { expiresIn: seconds },
      );
    },
    getObject,
    async deleteObject(bucket, key) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
    async transcribe(bucket, key) {
      const job = `tagalong-${randomUUID()}`;
      const output = `${key}.transcript.json`;
      await transcribe.send(
        new StartTranscriptionJobCommand({
          TranscriptionJobName: job,
          Media: { MediaFileUri: `s3://${bucket}/${key}` },
          IdentifyLanguage: true,
          OutputBucketName: bucket,
          OutputKey: output,
        }),
      );
      try {
        const deadline = Date.now() + TRANSCRIBE.timeoutMs;
        for (;;) {
          const result = await transcribe.send(
            new GetTranscriptionJobCommand({ TranscriptionJobName: job }),
          );
          const status = result.TranscriptionJob?.TranscriptionJobStatus;
          if (status === "COMPLETED") break;
          if (status === "FAILED") throw new TranscribeFailed(status);
          if (Date.now() > deadline) throw new TranscribeTimedOut(job);
          await sleep(TRANSCRIBE.pollMs);
        }
      } finally {
        await transcribe
          .send(
            new DeleteTranscriptionJobCommand({ TranscriptionJobName: job }),
          )
          .catch(() => undefined);
      }
      const body = await getObject(bucket, output);
      if (body === undefined) throw new TranscribeFailed("no output");
      const parsed = transcriptSchema.parse(JSON.parse(body.toString("utf8")));
      return parsed.results.transcripts
        .map((entry) => entry.transcript)
        .join(" ")
        .trim();
    },
  };
}
