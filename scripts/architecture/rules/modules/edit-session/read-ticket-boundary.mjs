import { defineRule } from '../../../diagnostics.mjs';
import { dependencyOrigins } from '../../../facts/imports.mjs';
import { callsFrom } from '../../../facts/imports.mjs';
import { readTicketLifecycles } from '../../../facts/read-tickets.mjs';
import { readTicketProtocol } from '../../../facts/read-ticket-protocol.mjs';

const ticketSource = 'src/shared/runtime/read-request.ts';

export const readTicketBoundaryRule = defineRule(
  'read-ticket-boundary',
  '.zcode/frontend-guidelines.md#共享读取与缓存',
  import.meta.url,
  (context, report) => {
    const protocol = readTicketProtocol(context.byPath.get(ticketSource));
    for (const file of context.frontend) {
      const ownsReads =
        file.role.layer === 'services' ||
        (file.role.layer === 'app' && file.role.role === 'composable') ||
        (file.role.layer === 'shared' && file.role.domain === 'runtime');
      if (!ownsReads)
        for (const edge of file.dependencies)
          for (const origin of dependencyOrigins(edge, context.byPath, (rel, name) => rel === ticketSource && protocol.owners.has(name)))
            if (origin.rel === ticketSource && protocol.owners.has(origin.name))
              report(file, edge, 'read tickets must be owned by a read runtime or composable', {
                target: origin.rel,
                symbol: origin.name,
                expected: 'read runtime or composable',
              });
      const ticketCalls = callsFrom(file, context.byPath, new Set([ticketSource]));
      const creations = ticketCalls.filter((call) => protocol.factories.has(call.name));
      for (const lifecycle of readTicketLifecycles(file, creations, context.byPath)) {
        for (const failure of lifecycle.flowFailures)
          report(file, failure, failure.message, { target: ticketSource, expected: failure.expected });
        if (!lifecycle.currentChecks.size)
          report(file, lifecycle, 'direct ReadTicket consumers must check the current result before publication', {
            target: ticketSource,
            symbol: [...protocol.factories].join(', '),
            expected: 'ticket.' + [...protocol.checks][0] + '()',
          });
        if (!lifecycle.invalidates.size)
          report(file, lifecycle, 'direct ReadTicket consumers must invalidate the ticket on release', {
            target: ticketSource,
            symbol: [...protocol.factories].join(', '),
            expected: 'ticket.' + [...protocol.invalidations][0] + '(reason)',
          });
      }
    }
  },
);
