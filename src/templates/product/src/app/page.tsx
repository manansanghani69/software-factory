import { db, tasks } from "@/db";

export const dynamic = "force-dynamic";

export default async function Home() {
  const rows = await db.select().from(tasks).all();

  return (
    <main style={{ maxWidth: 640, margin: "4rem auto", fontFamily: "system-ui" }}>
      <h1>{{product}}</h1>
      <p style={{ color: "#666" }}>A web app produced by the AI Software Factory.</p>

      <h2>Tasks</h2>
      {rows.length === 0 ? (
        <p style={{ color: "#999" }}>No tasks yet.</p>
      ) : (
        <ul>
          {rows.map((t) => (
            <li key={t.id}>
              <strong>{t.title}</strong> — {t.status}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}