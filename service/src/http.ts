// The one place a response body is read, through a schema (types-and-lint.md).
import type { z } from "zod";
import { HttpError } from "./log.ts";

/** Fetch `url` and parse its JSON body with `schema`. A non-2xx answer throws HttpError. */
export async function fetchJson<T>(
  where: string,
  url: string,
  init: RequestInit,
  schema: z.ZodType<T>,
): Promise<T> {
  const response = await fetch(url, init);
  // eslint-disable-next-line no-restricted-syntax -- the one place a response body is read
  const text = await response.text();
  if (!response.ok) throw new HttpError(where, response.status);
  const data: unknown = text === "" ? {} : JSON.parse(text);
  return schema.parse(data);
}

/** A request body as text, at most `limit` bytes; anything longer is cut. */
export async function readBody(
  stream: AsyncIterable<Buffer | string>,
  limit: number,
): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    size += buffer.length;
    if (size <= limit) chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}
