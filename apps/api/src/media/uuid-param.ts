import { Param, type PipeTransform } from '@nestjs/common';
import { Errors } from '../common/errors.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): boolean {
  return typeof value === 'string' && UUID.test(value);
}

class UuidPipe implements PipeTransform {
  transform(value: unknown): string {
    if (!isUuid(value)) throw Errors.notFound();
    return (value as string).toLowerCase();
  }
}

/** A route parameter that must be a UUID; anything else is a plain 404. */
export const UuidParam = (name: string) => Param(name, new UuidPipe());
