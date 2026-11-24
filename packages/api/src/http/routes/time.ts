import { createRoute, z } from '@hono/zod-openapi';
import { correctTimeEntrySchema, reportPeriodSchema } from '@pos/core';
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

const tags = ['Working time'];
const security = AUTHENTICATED;
const deps = (c: ApiContext) => ({ db: c.get('db') });

const TimeEntrySchema = z
  .object({
    id: z.uuid(),
    userId: z.uuid(),
    userName: z.string(),
    clockInAt: z.string().nullable(),
    clockOutAt: z.string().nullable(),
    businessDate: z.string(),
    minutes: z.number().int().nullable().openapi({ description: 'Whole minutes, closed only' }),
    status: z.string().openapi({ enum: ['open', 'closed', 'missing_out', 'missing_in'] }),
    corrected: z.boolean(),
    note: z.string().nullable(),
  })
  .openapi('TimeEntry', { description: 'One clock in and out of a person (DEC-054)' });

const TimesheetSchema = z
  .object({
    timezone: z.string(),
    entries: z.array(TimeEntrySchema),
    people: z.array(
      z.object({
        userId: z.uuid(),
        userName: z.string(),
        entries: z.number().int(),
        minutes: z.number().int(),
        incomplete: z.number().int(),
      }),
    ),
    totalMinutes: z.number().int(),
    incomplete: z.number().int(),
  })
  .openapi('Timesheet');

/** The staff's working time at the current location (RF-A09, DEC-054). */
export function registerTimeRoutes(app: ApiApp) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/time-entries',
      tags,
      security,
      summary: 'Clock in and out of the staff for some business days, with hours per person',
      request: { query: reportPeriodSchema },
      responses: { 200: jsonResponse(TimesheetSchema, 'Timesheet'), ...ERROR_RESPONSES },
    }),
    async (c) =>
      c.json(await service.listTimeEntries(deps(c), actorOf(c), c.req.valid('query')), 200),
  );

  app.openapi(
    createRoute({
      method: 'put',
      path: '/time-entries/{id}',
      tags,
      security,
      summary: 'Correct the times of an entry, with the reason (audited)',
      request: { params: UuidParam, body: jsonBody(correctTimeEntrySchema) },
      responses: { 204: NoContent, ...ERROR_RESPONSES },
    }),
    async (c) => {
      await service.correctTimeEntry(
        deps(c),
        actorOf(c),
        c.req.valid('param').id,
        c.req.valid('json'),
      );
      return c.body(null, 204);
    },
  );
}
