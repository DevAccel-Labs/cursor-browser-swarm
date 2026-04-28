import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type Ticket = {
  id: number;
  title: string;
  status: "Open" | "In Progress" | "Closed";
  priority: "Low" | "Medium" | "High";
};

const tickets: Ticket[] = [
  { id: 1, title: "Dropdown clipped in table toolbar", status: "Open", priority: "High" },
  { id: 2, title: "Modal close button broken", status: "In Progress", priority: "Medium" },
  { id: 3, title: "Settings save does not persist", status: "Closed", priority: "Low" },
];

function Dashboard(): JSX.Element {
  useEffect(() => {
    console.error("seeded dashboard render error: analytics card missing dataset");
  }, []);

  return (
    <main>
      <h1>Dashboard</h1>
      <section className="cards">
        <button type="button">Open revenue card</button>
        <button type="button">Filter activity</button>
        <a href="/projects/acme/tickets">View tickets</a>
      </section>
      <p className="empty">
        No incidents right now. <a href="/missing-empty-state-route">Create incident</a>
      </p>
    </main>
  );
}

function Tickets(): JSX.Element {
  const [statusFilter, setStatusFilter] = useState("All");
  const [modalOpen, setModalOpen] = useState(false);
  const [page, setPage] = useState(1);

  useEffect(() => {
    void fetch("/api/seeded-ticket-failure");
  }, []);

  const filtered = useMemo(
    () =>
      statusFilter === "All" ? tickets : tickets.filter((ticket) => ticket.status === statusFilter),
    [statusFilter],
  );

  return (
    <main>
      <h1>Tickets</h1>
      <div className="ticket-shell">
        <div className="toolbar">
          <label>
            Status
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option>All</option>
              <option>Open</option>
              <option>In Progress</option>
              <option>Closed</option>
            </select>
          </label>
          <div className="dropdown-wrapper">
            <button type="button" className="dropdown-button">
              Status filter
            </button>
            <div className="dropdown-menu">
              <button type="button">Open</button>
              <button type="button">In Progress</button>
              <button type="button">Closed</button>
            </div>
          </div>
          <button type="button" onClick={() => setModalOpen(true)}>
            Create ticket
          </button>
        </div>
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Status</th>
              <th>Priority</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((ticket) => (
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
      </div>
      <div className="pagination">
        <span>Page {page}</span>
        <button type="button" onClick={() => setPage(page)}>
          Next page
        </button>
      </div>
      {modalOpen ? (
        <div className="modal" role="dialog" aria-label="Create ticket">
          <div className="modal-card">
            <h2>Create ticket</h2>
            <label>
              Title
              <input placeholder="Ticket title" />
            </label>
            <button type="button">Close</button>
            <button type="button" onClick={() => setModalOpen(false)}>
              Create
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function SettingsTeam(): JSX.Element {
  const [role, setRole] = useState("Member");
  const [message, setMessage] = useState("");

  return (
    <main>
      <h1>Team Settings</h1>
      <label>
        Invite email
        <input type="email" placeholder="teammate@example.com" />
      </label>
      <label>
        Role
        <select value={role} onChange={(event) => setRole(event.target.value)}>
          <option>Member</option>
          <option>Admin</option>
        </select>
      </label>
      <button
        type="button"
        onClick={() => setMessage(`Saved ${role}, but persistence is seeded-broken.`)}
      >
        Save settings
      </button>
      <button type="button">Cancel</button>
      {message ? <p className="success">{message}</p> : null}
    </main>
  );
}

function App(): JSX.Element {
  const path = window.location.pathname;
  if (path === "/dashboard" || path === "/") {
    return <Dashboard />;
  }
  if (path === "/projects/acme/tickets") {
    return <Tickets />;
  }
  if (path === "/settings/team") {
    return <SettingsTeam />;
  }
  return (
    <main>
      <h1>Not Found</h1>
      <a href="/dashboard">Back to dashboard</a>
    </main>
  );
}

const root = createRoot(document.querySelector("#root") as HTMLElement);
root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
