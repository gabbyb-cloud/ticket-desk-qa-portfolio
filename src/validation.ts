import { z } from 'zod';

const codePoints = (value: string) => Array.from(value).length;
export const loginSchema = z.strictObject({
  email: z.string().trim().toLowerCase().max(254).email(),
  password: z.string().refine(value => codePoints(value) >= 1 && codePoints(value) <= 128),
});
export const createSchema = z.strictObject({
  title: z.string().trim().refine(value => codePoints(value) >= 1 && codePoints(value) <= 120),
  description: z.string().refine(value => codePoints(value) <= 2000),
});
export const updateSchema = z.strictObject({ status: z.enum(['open', 'closed']) });
export const emptySchema = z.strictObject({});
export const uuidSchema = z.uuid();
