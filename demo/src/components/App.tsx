import { useEffect, useMemo, useState } from "react";
import "./style.css";

type Ticket = {
  id: string;
  title: string;
  status: "Open" | "Closed" | "Blocked";
  priority: "Low" | "Medium" | "High";
};

const tickets: Ticket[] = [
  { id: "TCK-101", title: "Dropdown clipped in filters", status: "Open", priority: "High" },
  { id: "TCK-102", title: "Modal close button broken", status: "Blocked", priority: "Medium" },
  { id: "TCK-103", title: "Pagination does not advance", status: "Closed", priority: "Low" },
];

export function App() {
  const path = window.location.pathname;
  if (path.startsWith("/projects/acme/tickets")) {
    return <TicketsPage />;
  }
  if (path.startsWith("/settings/team")) {
    return <SettingsTeamPage />;
  }
  return <DashboardPage />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="shell">
      <nav className="nav">
        <a href="/dashboard">Dashboard</a>
        <a href="/projects/acme/tickets">Tickets</a>
        <a href="/settings/team">Team settings</a>
      </nav>
      <main>{children}</main>
    </div>
  );
}

function DashboardPage() {
  useEffect(() => {
    console.error("seeded-dashboard-error: failed to render revenue sparkline");
  }, []);

  return (
    <Shell>
      <h1>Dashboard</h1>
      <div className="grid">
        <button type="button">Open projects card</button>
        <button type="button">Filter activity</button>
        <a className="button" href="/missing-empty-state">
          Empty state CTA
        </a>
      </div>
    </Shell>
  );
}

function TicketsPage() {
  const [statusOpen, setStatusOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [sortAsc, setSortAsc] = useState(true);

  useEffect(() => {
    fetch("/api/tickets?seededFailure=1").catch(() => undefined);
  }, []);

  const visibleTickets = useMemo(() => {
    return [...tickets].sort((a, b) => {
      const direction = sortAsc ? 1 : -1;
      return a.title.localeCompare(b.title) * direction;
    });
  }, [sortAsc]);

  return (
    <Shell>
      <h1>Tickets</h1>
      <section className="ticket-panel">
        <div className="filters">
          <button type="button" onClick={() => setStatusOpen((open) => !open)}>
            Status filter
          </button>
          {statusOpen ? (
            <div className="dropdown">
              <button type="button">Open</button>
              <button type="button">Closed</button>
              <button type="button">Blocked</button>
            </div>
          ) : null}
        </div>
      </section>
      <button type="button" onClick={() => setModalOpen(true)}>
        Create ticket
      </button>
      {modalOpen ? (
        <div className="modal" role="dialog" aria-label="Create ticket">
          <h2>Create ticket</h2>
          <label>
            Title
            <input placeholder="Ticket title" />
          </label>
          <button type="button">Save ticket</button>
          <button type="button" onClick={() => setModalOpen(true)}>
            Close
          </button>
        </div>
      ) : null}
      <table>
        <thead>
          <tr>
            <th>
              <button type="button" onClick={() => setSortAsc(true)}>
                Sort title
              </button>
            </th>
            <th>Status</th>
            <th>Priority</th>
          </tr>
        </thead>
        <tbody>
          {visibleTickets.map((ticket) => (
            <tr key={ticket.id}>
              <td>
                <button type="button">{ticket.title}</button>
              </td>
              <td>{ticket.status}</td>
              <td>{ticket.priority}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>Page {page}</p>
      <button type="button" onClick={() => setPage(1)}>
        Next page
      </button>
    </Shell>
  );
}

function SettingsTeamPage() {
  const [saved, setSaved] = useState(false);
  const [role, setRole] = useState("member");

  return (
    <Shell>
      <h1>Team settings</h1>
      <button type="button">Invite teammate</button>
      <label>
        Role
        <select value={role} onChange={(event) => setRole(event.target.value)}>
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
      </label>
      <button type="button" onClick={() => setSaved(true)}>
        Save settings
      </button>
      {saved ? (
        <p role="status">Saved, but this seeded bug does not persist after reload.</p>
      ) : null}
    </Shell>
  );
}
