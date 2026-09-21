// src/routes/uploads.ts
import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import sharp from 'sharp';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { requireAuth } from '../lib/middleware.js';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'public', 'uploads');

// ─── Limits ─────────────────────────────────────────────
const MAX_BYTES   = 5 * 1024 * 1024;              // 5 MB per file
const MAX_DIM     = 1600;                          // longest edge after resize
const WEBP_Q      = 85;
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

// ─── Helpers ────────────────────────────────────────────

/** Partitioned upload dir, e.g. public/uploads/2026-09/ */
function monthFolder(d = new Date()): string {
  const yyyy = d.getUTCFullYear();
  const mm   = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

/** Only allow the basename, strip anything weird */
function safeName(original: string): string {
  return path
    .basename(original || '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 100) || 'upload';
}

/**
 * Quick magic-byte sniff. Returns the real mime or null.
 * Doesn't replace a real antivirus; just blocks obvious spoofing.
 */
function sniffMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) return 'image/png';
  // GIF: GIF87a or GIF89a
  if (
    buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38 &&
    (buf[4] === 0x37 || buf[4] === 0x39) && buf[5] === 0x61
  ) return 'image/gif';
  // WebP: RIFF....WEBP
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return 'image/webp';
  return null;
}

// ─── Routes ─────────────────────────────────────────────
export async function uploadRoutes(app: FastifyInstance) {
  // ── Multipart plugin ─────────────────────────────────
  await app.register(multipart, {
    limits: {
      fileSize: MAX_BYTES,
      files:    1,                    // one file per request
      fields:   10,                   // small number of text fields
      parts:    12,                   // hard cap on total multipart parts
    },
  });

  // ── Ensure upload root exists ────────────────────────
  await fs.mkdir(UPLOAD_ROOT, { recursive: true });
  // Add .gitkeep so the folder is committable but empty
  const gitkeep = path.join(UPLOAD_ROOT, '.gitkeep');
  await fs.writeFile(gitkeep, '').catch(() => { /* already exists */ });

  // ── Health (no auth, for confirming the route is live) ──
  app.get('/uploads/health', async () => ({
    ok: true,
    uploadRoot: UPLOAD_ROOT,
    maxBytes: MAX_BYTES,
    maxDim: MAX_DIM,
  }));

  // ── POST /uploads/image ─────────────────────────────
  app.post(
    '/uploads/image',
    { preHandler: requireAuth },
    async (req, reply) => {
      // 1. Parse the file
      let data;
      try {
        data = await req.file();
      } catch (err: any) {
        if (err.code === 'FST_REQ_FILE_TOO_LARGE') {
          return reply.code(413).send({
            error: 'FILE_TOO_LARGE',
            message: `File exceeds ${MAX_BYTES / 1024 / 1024} MB limit`,
          });
        }
        req.log.warn({ err }, 'multipart parse failed');
        return reply.code(400).send({
          error: 'BAD_MULTIPART',
          message: 'Could not parse multipart body',
        });
      }

      if (!data) {
        return reply.code(400).send({
          error: 'NO_FILE',
          message: 'No file uploaded. Use multipart field name "file".',
        });
      }

      // 2. Check mimetype advertised by client
      if (!ALLOWED_MIME.has(data.mimetype)) {
        // Drain the stream to avoid hanging the socket
        await data.toBuffer().catch(() => {});
        return reply.code(415).send({
          error: 'UNSUPPORTED_TYPE',
          message: `Allowed types: ${[...ALLOWED_MIME].join(', ')}`,
        });
      }

      // 3. Read whole file into memory (5 MB cap is fine)
      let inputBuffer: Buffer;
      try {
        inputBuffer = await data.toBuffer();
      } catch (err: any) {
        if (err.code === 'FST_REQ_FILE_TOO_LARGE') {
          return reply.code(413).send({
            error: 'FILE_TOO_LARGE',
            message: `File exceeds ${MAX_BYTES / 1024 / 1024} MB limit`,
          });
        }
        throw err;
      }

      if (inputBuffer.length === 0) {
        return reply.code(400).send({
          error: 'EMPTY_FILE',
          message: 'Uploaded file is empty',
        });
      }

      // 4. Sniff magic bytes — reject spoofed mimetypes
      const sniffed = sniffMime(inputBuffer);
      if (!sniffed || !ALLOWED_MIME.has(sniffed)) {
        return reply.code(415).send({
          error: 'NOT_AN_IMAGE',
          message: 'File does not look like a supported image',
        });
      }

      // 5. Process with sharp
      let processed: Buffer;
      let outExt   = 'webp';
      let outMime  = 'image/webp';
      let width:  number | null = null;
      let height: number | null = null;

      try {
        const pipeline = sharp(inputBuffer, { failOn: 'none' }).rotate();
        const meta = await pipeline.metadata();

        // Reject 0-byte or absurd images
        if (!meta.width || !meta.height) {
          return reply.code(415).send({
            error: 'INVALID_IMAGE',
            message: 'Image has no readable dimensions',
          });
        }

        const result = await pipeline
          .resize({
            width:  MAX_DIM,
            height: MAX_DIM,
            fit: 'inside',
            withoutEnlargement: true,
          })
          .webp({ quality: WEBP_Q })
          .toBuffer({ resolveWithObject: true });

        processed = result.data;
        width  = result.info.width;
        height = result.info.height;
      } catch (err: any) {
        req.log.warn({ err }, 'sharp processing failed, storing original');
        // Fall back: store the original bytes as-is
        processed = inputBuffer;
        outExt  = (sniffed.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
        outMime = sniffed;
      }

      // 6. Write to disk (date-partitioned)
      const folder   = monthFolder();
      const dir      = path.join(UPLOAD_ROOT, folder);
      await fs.mkdir(dir, { recursive: true });

      const rand     = crypto.randomBytes(12).toString('hex');
      const stamp    = Date.now();
      const filename = `${stamp}-${rand}.${outExt}`;
      const filepath = path.join(dir, filename);

      await fs.writeFile(filepath, processed);
      const stat = await fs.stat(filepath);

      // 7. Respond
      const publicUrl = `/uploads/${folder}/${filename}`;

      req.log.info(
        {
          bytes: processed.length,
          originalBytes: inputBuffer.length,
          mime: outMime,
          width,
          height,
        },
        'image uploaded',
      );

      return reply.code(201).send({
        url:        publicUrl,
        filename,
        folder,
        size:       stat.size,
        mime:       outMime,
        width,
        height,
        original: {
          name: safeName(data.filename),
          size: inputBuffer.length,
          mime: sniffed,
        },
      });
    },
  );

  app.log.info('✅ uploadRoutes registered: POST /uploads/image');
}