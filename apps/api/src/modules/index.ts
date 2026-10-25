import type { FastifyPluginAsync } from 'fastify';
import { authRoutes } from './auth/routes.js';
import { userRoutes } from './users/routes.js';
import { orgRoutes } from './orgs/routes.js';
import { jobRoutes } from './jobs/routes.js';
import { resumeRoutes } from './resumes/routes.js';
import { inviteRoutes } from './invites/routes.js';
import { interviewRoutes } from './interviews/routes.js';
import { codingRoutes } from './coding/routes.js';
import { proctoringRoutes } from './proctoring/routes.js';
import { reportRoutes } from './reports/routes.js';
import { aiRoutes } from './ai/routes.js';
import { adminRoutes } from './admin/routes.js';

/** All versioned API routes. Each module registers its own prefix. */
export const apiRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { schema: { hide: true } }, async () => ({ name: 'HireWithSense API', version: 'v1' }));
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(userRoutes, { prefix: '/users' });
  await app.register(orgRoutes, { prefix: '/orgs' });
  await app.register(jobRoutes, { prefix: '/jobs' });
  await app.register(resumeRoutes, { prefix: '/resumes' });
  await app.register(inviteRoutes, { prefix: '/invites' });
  await app.register(interviewRoutes, { prefix: '/interviews' });
  await app.register(codingRoutes);
  await app.register(proctoringRoutes);
  await app.register(reportRoutes);
  await app.register(aiRoutes, { prefix: '/ai' });
  await app.register(adminRoutes, { prefix: '/admin' });
};
