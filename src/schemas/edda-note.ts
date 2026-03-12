import { z } from 'zod';

export const EddaNoteInput = z.object({
  text: z.string().min(1),
  role: z.string().optional(),
  tags: z.array(z.string()).optional(),
});
