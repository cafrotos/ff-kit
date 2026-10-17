import { createUserSchema } from '../schemas/user.js'
import { validate } from '../middleware/validate.js'
export function register(app, repo) {
  app.post('/users', validate(createUserSchema), async (req, res) => {
    res.status(201).json(await repo.createUser(req.body))
  })
}
