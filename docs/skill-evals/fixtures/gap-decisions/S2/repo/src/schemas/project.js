import { z } from 'zod'
export const createProjectSchema = z.object({
  title: z.string().trim().min(1).max(200),
  ownerEmail: z.string().trim().email(),
})
