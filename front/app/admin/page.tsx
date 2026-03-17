"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Doc = { id: string; title: string; filename: string; createdAt: string };
type User = { id: string; email: string; name?: string; role: "ADMIN" | "USER" };

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:5000";

export default function AdminPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [docTitle, setDocTitle] = useState("");
  const [docFile, setDocFile] = useState<File | null>(null);
  const [userEmail, setUserEmail] = useState("");
  const [userPassword, setUserPassword] = useState("");
  const [userName, setUserName] = useState("");
  const [userRole, setUserRole] = useState<"ADMIN" | "USER">("USER");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const stored = localStorage.getItem("admin_token");
    if (!stored) {
      router.push("/login");
      return;
    }

    setToken(stored);
  }, [router]);

  useEffect(() => {
    if (!token) return;
    void refreshAll(token);
  }, [token]);

  async function refreshAll(authToken: string) {
    try {
      const [docsRes, usersRes] = await Promise.all([
        fetch(`${BACKEND_URL}/documents`, {
          headers: { Authorization: `Bearer ${authToken}` },
        }),
        fetch(`${BACKEND_URL}/users`, {
          headers: { Authorization: `Bearer ${authToken}` },
        }),
      ]);

      if (docsRes.ok) {
        setDocs(await docsRes.json());
      }

      if (usersRes.ok) {
        setUsers(await usersRes.json());
      }
    } catch {
      setMessage("Failed to fetch admin data");
    }
  }

  async function uploadDocument(e: FormEvent) {
    e.preventDefault();
    if (!token || !docFile) return;

    const form = new FormData();
    form.append("file", docFile);
    if (docTitle.trim()) form.append("title", docTitle.trim());

    const res = await fetch(`${BACKEND_URL}/documents/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });

    if (!res.ok) {
      setMessage("Document upload failed");
      return;
    }

    setMessage("Document uploaded");
    setDocTitle("");
    setDocFile(null);
    await refreshAll(token);
  }

  async function deleteDocument(id: string) {
    if (!token) return;

    const res = await fetch(`${BACKEND_URL}/documents/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      setMessage("Failed to delete document");
      return;
    }

    setMessage("Document deleted");
    await refreshAll(token);
  }

  async function createUser(e: FormEvent) {
    e.preventDefault();
    if (!token) return;

    const res = await fetch(`${BACKEND_URL}/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        email: userEmail,
        password: userPassword,
        name: userName || undefined,
        role: userRole,
      }),
    });

    if (!res.ok) {
      setMessage("Failed to create user");
      return;
    }

    setMessage("User created");
    setUserEmail("");
    setUserPassword("");
    setUserName("");
    setUserRole("USER");
    await refreshAll(token);
  }

  async function deleteUser(id: string) {
    if (!token) return;

    const res = await fetch(`${BACKEND_URL}/users/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      setMessage("Failed to delete user");
      return;
    }

    setMessage("User deleted");
    await refreshAll(token);
  }

  function logout() {
    localStorage.removeItem("admin_token");
    localStorage.removeItem("admin_user");
    router.push("/login");
  }

  return (
    <div className="admin-shell">
      <header className="admin-header">
        <div>
          <h1>Admin Panel</h1>
          <p>Manage documents and users</p>
        </div>
        <div className="admin-actions">
          <a href="/chat">Open chat</a>
          <button onClick={logout}>Logout</button>
        </div>
      </header>

      {message ? <div className="flash-msg">{message}</div> : null}

      <section className="admin-grid">
        <article className="card">
          <h2>Upload Document</h2>
          <form onSubmit={uploadDocument} className="stack-form">
            <input
              value={docTitle}
              onChange={(e) => setDocTitle(e.target.value)}
              placeholder="Optional title"
            />
            <input
              type="file"
              onChange={(e) => setDocFile(e.target.files?.[0] ?? null)}
              required
            />
            <button type="submit">Upload and ingest</button>
          </form>

          <h3>Documents</h3>
          <div className="table-box">
            {docs.map((doc) => (
              <div key={doc.id} className="row">
                <div>
                  <strong>{doc.title}</strong>
                  <small>{doc.filename}</small>
                </div>
                <button onClick={() => deleteDocument(doc.id)}>Delete</button>
              </div>
            ))}
            {docs.length === 0 ? <p>No documents</p> : null}
          </div>
        </article>

        <article className="card">
          <h2>Create User</h2>
          <form onSubmit={createUser} className="stack-form">
            <input value={userEmail} onChange={(e) => setUserEmail(e.target.value)} placeholder="Email" required />
            <input value={userPassword} onChange={(e) => setUserPassword(e.target.value)} placeholder="Password" type="password" required />
            <input value={userName} onChange={(e) => setUserName(e.target.value)} placeholder="Name (optional)" />
            <select value={userRole} onChange={(e) => setUserRole(e.target.value as "ADMIN" | "USER")}> 
              <option value="USER">USER</option>
              <option value="ADMIN">ADMIN</option>
            </select>
            <button type="submit">Create user</button>
          </form>

          <h3>Users</h3>
          <div className="table-box">
            {users.map((user) => (
              <div key={user.id} className="row">
                <div>
                  <strong>{user.email}</strong>
                  <small>{user.role}{user.name ? ` | ${user.name}` : ""}</small>
                </div>
                <button onClick={() => deleteUser(user.id)}>Delete</button>
              </div>
            ))}
            {users.length === 0 ? <p>No users</p> : null}
          </div>
        </article>
      </section>
    </div>
  );
}
