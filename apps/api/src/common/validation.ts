import { Body, type PipeTransform, Query } from '@nestjs/common';
import type { z } from 'zod';
import { Errors } from './errors.js';
import { zodFields } from './error.filter.js';

class ZodPipe<T extends z.ZodTypeAny> implements PipeTransform {
  constructor(private readonly schema: T) {}
  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value ?? {});
    if (!result.success) throw Errors.validation(zodFields(result.error));
    return result.data;
  }
}

/** Validated request body: `@ZBody(SignUpInput) input: SignUpInput`. */
export const ZBody = <T extends z.ZodTypeAny>(schema: T) => Body(new ZodPipe(schema));
/** Validated query string: `@ZQuery(FeedQuery) query: FeedQuery`. */
export const ZQuery = <T extends z.ZodTypeAny>(schema: T) => Query(new ZodPipe(schema));

export function parseOrThrow<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  return new ZodPipe(schema).transform(value);
}
