// The one module that reaches AWS (types-and-lint.md).
import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  GetParameterCommand,
  PutParameterCommand,
  SSMClient,
} from "@aws-sdk/client-ssm";

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
}

export function realAws(region: string | undefined): Aws {
  const config = region === undefined ? {} : { region };
  const ssm = new SSMClient(config);
  const s3 = new S3Client(config);
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
    async getObject(bucket, key) {
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
    },
    async deleteObject(bucket, key) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}
