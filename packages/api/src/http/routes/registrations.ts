import { createRoute, z } from '@hono/zod-openapi';
import { REGISTRATION_STATUSES, submitRegistrationSchema } from '@pos/core';
import * as service from '../../services/people';
import { actorOf, type ApiApp, type ApiContext } from '../env';
import {
  AUTHENTICATED,
  ERROR_RESPONSES,
  jsonBody,
  jsonResponse,
  NoContent,
  UuidParam,
} from '../schemas';

// Input schemas come from @pos/core as plain Zod: never call `.openapi()` on them.

const tags = ['Staff registrations'];
const deps = (c: ApiContext) => ({ db: c.get('db') });

const InviteSchema = z
  .object({
    code: z.string().openapi({ description: 'Shown once; only its hash is stored' }),
    expiresAt: z.string(),
    maxUses: z.number().int(),
  })
  .openapi('StaffInvite');

const RegistrationSchema = z
  .object({
    id: z.uuid(),
    displayName: z.string(),
    uiLanguage: z.string(),
    status: z.string().openapi({ enum: [...REGISTRATION_STATUSES] }),
    createdAt: z.string(),
  })
  .openapi('StaffRegistration');

/** A new waiter joins from their own phone, approved by the manager (DEC-055). */
export function registerRegistrationRoutes(app: ApiApp) {
  app.openapi(
    createRoute({
      method: 'post',
      path: '/staff-invites',
      tags,
      security: AUTHENTICATED,
      summary: 'A code (as a QR) for new waiters of the current location: an hour, up to ten',
      responses: { 201: jsonResponse(InviteSchema, 'Invitation'), ...ERROR_RESPONSES },
    }),
    async (c) => c.json(await service.issueStaffInvite(deps(c), actorOf(c)), 201),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/staff-registrations',
      tags,
      security: [],
      summary: 'Join with an invitation code: name, PIN and language (anonymous)',
      description:
        'The code is the credential. 404 `invalid_code` for a wrong, expired or used-up code; ' +
        '409 `pin_taken` when somebody has that PIN (five of those kill the code). Nothing opens ' +
        'until a manager approves.',
      request: { body: jsonBody(submitRegistrationSchema) },
      responses: {
        201: jsonResponse(
          z.object({ id: z.uuid(), locationName: z.string() }),
          'Waiting for the manager',
        ),
        ...ERROR_RESPONSES,
      },
    }),
    async (c) => c.json(await service.submitStaffRegistration(deps(c), c.req.valid('json')), 201),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/staff-registrations',
      tags,
      security: AUTHENTICATED,
      summary: 'People waiting for approval at the current location',
      responses: {
        200: jsonResponse(z.array(RegistrationSchema), 'Pending registrations'),
        ...ERROR_RESPONSES,
      },
    }),
    async (c) => c.json(await service.listStaffRegistrations(deps(c), actorOf(c)), 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/staff-registrations/{id}/approve',
      tags,
      security: AUTHENTICATED,
      summary: 'Let the person in: a waiter with the PIN they chose',
      request: { params: UuidParam },
      responses: {
        200: jsonResponse(z.object({ userId: z.uuid() }), 'Created user'),
        ...ERROR_RESPONSES,
      },
    }),
    async (c) =>
      c.json(
        await service.approveStaffRegistration(deps(c), actorOf(c), c.req.valid('param').id),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/staff-registrations/{id}/reject',
      tags,
      security: AUTHENTICATED,
      summary: 'Do not let the person in (nothing is deleted)',
      request: { params: UuidParam },
      responses: { 204: NoContent, ...ERROR_RESPONSES },
    }),
    async (c) => {
      await service.rejectStaffRegistration(deps(c), actorOf(c), c.req.valid('param').id);
      return c.body(null, 204);
    },
  );
}
