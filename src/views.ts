import type { Ticket } from './store.js';

// Only fixed templates compose HTML. Every dynamic value is escaped, including
// values in quoted attributes. No raw user HTML, scripts, styles or URL schemes.
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}
const hidden = (token: string) => `<input type="hidden" name="_csrf" value="${escapeHtml(token)}">`;
const alert = (message = '') => message ? `<p role="alert">${escapeHtml(message)}</p>` : '';
export function layout(title: string, body: string, token?: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)} — Ticket Desk</title></head><body><header><p>Ticket Desk · Synthetic demo</p>${token ? `<nav aria-label="Main"><a href="/tickets">Tickets</a> <a href="/tickets/new">Create ticket</a></nav><form action="/logout" method="post">${hidden(token)}<button type="submit">Log out</button></form>` : ''}</header><main><h1>${escapeHtml(title)}</h1>${body}</main></body></html>`;
}
export function loginView(token: string, message = '', email = ''): string {
  return layout('Log in', `${alert(message)}<form action="/login" method="post">${hidden(token)}<p><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" required maxlength="254" value="${escapeHtml(email)}"></p><p><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required></p><button type="submit">Log in</button></form>`);
}
export function createView(token: string, message = '', title = '', description = ''): string {
  return layout('Create ticket', `${alert(message)}<form action="/tickets" method="post">${hidden(token)}<p><label for="title">Title</label><input id="title" name="title" required value="${escapeHtml(title)}"></p><p><label for="description">Description</label><textarea id="description" name="description">${escapeHtml(description)}</textarea></p><button type="submit">Create ticket</button></form>`, token);
}
export function listView(token: string, tickets: Ticket[]): string {
  return layout('Tickets', tickets.length ? `<ul>${tickets.map(ticket => `<li><a href="/tickets/${escapeHtml(ticket.id)}">${escapeHtml(ticket.title)}</a> <span>${escapeHtml(ticket.status)}</span></li>`).join('')}</ul>` : '<p>No tickets yet.</p>', token);
}
export function detailView(token: string, ticket: Ticket, message = ''): string {
  return layout('Ticket details', `${alert(message)}<h2>${escapeHtml(ticket.title)}</h2><p data-testid="description">${escapeHtml(ticket.description)}</p><p>Status: <span data-testid="status">${escapeHtml(ticket.status)}</span></p><form action="/tickets/${escapeHtml(ticket.id)}/status" method="post">${hidden(token)}<label for="status">Status</label><select id="status" name="status"><option value="open"${ticket.status === 'open' ? ' selected' : ''}>Open</option><option value="closed"${ticket.status === 'closed' ? ' selected' : ''}>Closed</option></select><button type="submit">Save status</button></form>`, token);
}
export const errorView = (message: string) => layout('Request failed', alert(message));
