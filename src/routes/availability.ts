import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getAvailableSlots } from '../services/slot-generator.js';

const QuerySchema = z.object({
  businessId: z.string().uuid(),
  serviceId: z.string().uuid(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  staffId: z.string().uuid().optional(),
  stepMinutes: z.coerce.number().int().min(5).max(60).optional(),
});

export async function availabilityRoutes(app: FastifyInstance) {
  app.get('/availability', async (req, reply) => {
    const q = QuerySchema.parse(req.query);
    const slots = await getAvailableSlots(q);
    return reply.send({ slots });
  });
}