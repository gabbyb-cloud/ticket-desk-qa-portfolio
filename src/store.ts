import { randomUUID } from 'node:crypto';
import { DEMO_PASSWORD, hashPassword, type PasswordHash } from './auth.js';

export type User = { id: string; email: string; hash: PasswordHash };
export type Ticket = { id: string; title: string; description: string; status: 'open' | 'closed'; ownerId: string };

export async function seedStore() {
  const users = new Map<string, User>();
  for (const name of ['alice', 'bob']) {
    const email = `${name}@example.test`;
    users.set(email, { id: `user-${name}`, email, hash: await hashPassword(DEMO_PASSWORD) });
  }
  const dummyHash = await hashPassword(DEMO_PASSWORD);
  const tickets = new Map<string, Ticket>();
  return {
    users, dummyHash, tickets,
    create(ownerId: string, input: Pick<Ticket, 'title' | 'description'>): Ticket {
      const ticket: Ticket = { id: randomUUID(), ...input, status: 'open', ownerId };
      tickets.set(ticket.id, ticket);
      return ticket;
    },
    list(ownerId: string) { return [...tickets.values()].filter(ticket => ticket.ownerId === ownerId); },
  };
}
