// src/lib/id.ts
import { randomUUID } from 'node:crypto';
export const newId = () => randomUUID();