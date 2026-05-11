import { useState, useEffect, useCallback } from "react";
import Database from "@tauri-apps/plugin-sql";
import "./App.css";

// ---------------------------------------------------------------
// Types
// ---------------------------------------------------------------
interface Todo {
  id: number;
  text: string;
  completed: number; // SQLite stores booleans as 0/1
  created_at: string;
}

type Filter = "all" | "active" | "completed";

// ---------------------------------------------------------------
// App
// ---------------------------------------------------------------
function App() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [newText, setNewText] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [db, setDb] = useState<Database | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // -----------------------------------------------------------
  // 1. Open (or create) the SQLite database and init the table
  // -----------------------------------------------------------
  useEffect(() => {
    async function initDb() {
      try {
        // Open the SQLite database from the app data directory
        const database = await Database.load("sqlite:todo.db");

        setDb(database);

        // Load existing todos
        const rows = await database.select<Todo[]>(
          "SELECT * FROM todos ORDER BY created_at DESC"
        );

        setTodos(rows);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    }

    initDb();
  }, []);

  // -----------------------------------------------------------
  // 2. CRUD helpers (stable callbacks, depend on db)
  // -----------------------------------------------------------
  const addTodo = useCallback(async () => {
    if (!db || !newText.trim()) return;
    try {
      const result = await db.execute(
        "INSERT INTO todos (text) VALUES (?)",
        [newText.trim()]
      );
      const id = result.lastInsertId;
      const rows = await db.select<Todo[]>(
        "SELECT * FROM todos WHERE id = ?",
        [id]
      );
      if (rows.length > 0) {
        setTodos((prev) => [rows[0], ...prev]);
      }
      setNewText("");
    } catch (e) {
      setError(String(e));
    }
  }, [db, newText]);

  const toggleTodo = useCallback(
    async (todo: Todo) => {
      if (!db) return;
      const newCompleted = todo.completed ? 0 : 1;
      try {
        await db.execute("UPDATE todos SET completed = ? WHERE id = ?", [
          newCompleted,
          todo.id,
        ]);
        setTodos((prev) =>
          prev.map((t) =>
            t.id === todo.id ? { ...t, completed: newCompleted } : t
          )
        );
      } catch (e) {
        setError(String(e));
      }
    },
    [db]
  );

  const deleteTodo = useCallback(
    async (id: number) => {
      if (!db) return;
      try {
        await db.execute("DELETE FROM todos WHERE id = ?", [id]);
        setTodos((prev) => prev.filter((t) => t.id !== id));
      } catch (e) {
        setError(String(e));
      }
    },
    [db]
  );

  const clearCompleted = useCallback(async () => {
    if (!db) return;
    try {
      await db.execute("DELETE FROM todos WHERE completed = 1");
      setTodos((prev) => prev.filter((t) => !t.completed));
    } catch (e) {
      setError(String(e));
    }
  }, [db]);

  // -----------------------------------------------------------
  // 3. Keyboard shortcut
  // -----------------------------------------------------------
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") addTodo();
  };

  // -----------------------------------------------------------
  // 4. Derived data
  // -----------------------------------------------------------
  const filtered = todos.filter((t) => {
    if (filter === "active") return !t.completed;
    if (filter === "completed") return !!t.completed;
    return true;
  });

  const remaining = todos.filter((t) => !t.completed).length;

  // -----------------------------------------------------------
  // 5. Render
  // -----------------------------------------------------------
  if (loading) {
    return (
      <div className="app">
        <div className="empty-state">
          <div className="icon">⏳</div>
          <p>Opening database…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="app">
        <div className="empty-state">
          <div className="icon">⚠️</div>
          <p style={{ color: "var(--danger)" }}>Database error</p>
          <p style={{ fontSize: "0.8rem", marginTop: "0.5rem" }}>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>📝 Tauri Todo</h1>
        <p>Built with React + Tauri + SQLite</p>
      </header>

      {/* ---- Add new todo ---- */}
      <div className="add-form">
        <input
          type="text"
          placeholder="What needs to be done?"
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
        />
        <button onClick={addTodo} disabled={!newText.trim()}>
          Add
        </button>
      </div>

      {/* ---- Filters ---- */}
      <div className="filters">
        {(["all", "active", "completed"] as Filter[]).map((f) => (
          <button
            key={f}
            className={filter === f ? "active" : ""}
            onClick={() => setFilter(f)}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* ---- Todo list ---- */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="icon">📭</div>
          <p>{todos.length === 0 ? "No todos yet — add one above!" : "Nothing to show for this filter."}</p>
        </div>
      ) : (
        <ul className="todo-list">
          {filtered.map((todo) => (
            <li
              key={todo.id}
              className={`todo-item ${todo.completed ? "completed" : ""}`}
            >
              <input
                type="checkbox"
                className="todo-checkbox"
                checked={!!todo.completed}
                onChange={() => toggleTodo(todo)}
              />
              <span className="todo-text">{todo.text}</span>
              <button
                className="todo-delete"
                onClick={() => deleteTodo(todo.id)}
                title="Delete"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* ---- Status bar ---- */}
      {todos.length > 0 && (
        <div className="status-bar">
          <span>
            {remaining} item{remaining !== 1 ? "s" : ""} remaining
          </span>
          {todos.length - remaining > 0 && (
            <button onClick={clearCompleted}>Clear completed</button>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
