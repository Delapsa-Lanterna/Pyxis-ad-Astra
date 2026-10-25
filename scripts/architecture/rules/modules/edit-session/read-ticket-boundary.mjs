import { defineRule } from '../../../diagnostics.mjs';
import { dependencyOrigins } from '../../../facts/imports.mjs';
import { callsFrom } from '../../../facts/imports.mjs';
import { readTicketLifecycles } from '../../../facts/read-tickets.mjs';

const ticketSource = 'src/shared/runtime/read-request.ts';
const primitives = new Set(['createReadTicket', 'createReadTicketOwner']);

export const readTicketBoundaryRule = defineRule(
  'read-ticket-boundary',
  '.zcode/overview.md#项目内关键链路',
  import.meta.url,
  (context, report) => {
    for (const file of context.frontend) {
      const ownsReads =
        file.role.layer === 'services' ||
        (file.role.layer === 'app' && file.role.role === 'composable') ||
        (file.role.layer === 'shared' && file.role.domain === 'runtime');
      if (!ownsReads)
        for (const edge of file.dependencies)
          for (const origin of dependencyOrigins(edge, context.byPath, (rel, name) => rel === ticketSource && primitives.has(name)))
            if (origin.rel === ticketSource && primitives.has(origin.name))
              report(file, edge, 'read tickets must be owned by a read runtime or composable', {
                target: origin.rel,
                symbol: origin.name,
                expected: 'read runtime or composable',
              });
      const ticketCalls = callsFrom(file, context.byPath, new Set([ticketSource]));
      const creations = ticketCalls.filter((call) => call.name === 'createReadTicket');
      for (const lifecycle of readTicketLifecycles(file, creations)) {
        if (!lifecycle.accepts.size)
          report(file, lifecycle, 'direct ReadTicket consumers must accept a result before publication', {
            target: ticketSource,
            symbol: 'createReadTicket',
            expected: 'ticket.accept()',
          });
        if (!lifecycle.invalidates.size)
          report(file, lifecycle, 'direct ReadTicket consumers must invalidate the ticket on release', {
            target: ticketSource,
            symbol: 'createReadTicket',
            expected: 'ticket.invalidate(reason)',
          });
      }
    }
  },
);
