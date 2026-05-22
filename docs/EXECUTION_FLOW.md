
# todo-tauri — Execution Flow Reference

> Generated from: `C:\DATA\lab\tauri\example\todo-tauri`
> Identifier: `com.fajarwz.todo-tauri`
> Package: `todo-new` (scaffolded from `create-tauri-app`)

---

## Architecture Overview

### Binary Layout

```
todo-new.exe
├── Rust binary (native, release: ~12 MB)
│   ├── tauri runtime ─── opens OS window (800×600)
│   ├── tauri-plugin-sql ─── manages SQLite connections + migrations
│   ├── tauri-plugin-opener ─── opens URLs/files in OS default handler
│   └── embedded assets: dist/ (Vite-bundled React SPA)
└── WebView2 (OS-provided, not bundled)
      └── React SPA ─── Vite + React 19 + TypeScript 5.8
```

### Process Model

```
 ┌── Rust Backend ──────────────────────┐    IPC (JSON)    ┌── WebView2 ──────────────────────────┐
 │                                      │                  │                                      │
 │  tauri::Builder                      │   React calls    │  React SPA                           │
 │   ├─ tauri-plugin-sql                │   ───────────►   │   ├─ App.tsx (state, CRUD, render)   │
 │   │    └─ SQLite → todo.db           │                  │   ├─ App.css (dark theme)            │
 │   └─ tauri-plugin-opener             │   ◄───────────   │   └─ @tauri-apps/plugin-sql          │
 │                                      │   Rust responds  │       (JS side of IPC)               │
 │  Capability gate                     │                  │                                      │
 │   └─ sql:allow-{load,execute,        │   Permission     │  Runs in browser sandbox             │
 │      select,close}                   │   check on       │  No direct filesystem access         │
 │                                      │   every call     │                                      │
 │  Full OS access                      │                  │  Vite 7 + React 19 + TypeScript 5.8  │
 │  Native filesystem, system APIs      │                  │                                      │
 └──────────────────────────────────────┘                  └──────────────────────────────────────┘

                            SQLite file on disk
                            %APPDATA%/com.fajarwz.todo-tauri/todo.db
```

---

## What is IPC?

**IPC = Inter-Process Communication.** It is how two separate programs (or two parts of the same program) talk to each other.

In a Tauri app, there are two worlds running side by side inside a single process:

```
┌─────────────────────┐          ┌──────────────────────┐
│  Rust Backend       │          │  WebView (Chromium)  │
│                     │   IPC    │                      │
│  • filesystem       │ ◄──────► │  • React UI          │
│  • SQLite           │  JSON    │  • HTML/CSS          │
│  • system APIs      │ messages │  • JavaScript        │
│  • native speed     │          │  • user interaction  │
└─────────────────────┘          └──────────────────────┘
```

The Rust backend has full access to the operating system: it can read files, open databases, spawn processes, and talk to hardware. The WebView is a browser sandbox: it can render HTML and run JavaScript, but it is locked away from the system for security.

**IPC is the bridge between them.** When React calls `Database.load("sqlite:todo.db")`, it is not opening SQLite directly. It sends a JSON message across the IPC bridge to the Rust side, which does the actual work and sends the result back:

```txt
React (JavaScript)                    Rust (native)
─────────────────────────────────────────────────────
db.execute("INSERT...")  ──IPC──►   sql plugin → SQLite
                                     ↓
                                   INSERT INTO todos...
                                     ↓
                         ◄──IPC──  { lastInsertId: 3 }
```

### Why this matters

- **Without IPC**, the WebView could only use browser APIs (localStorage, fetch, etc.). No filesystem, no database, no native windows.
- **With IPC**, React can do anything Rust can do, but the WebView stays sandboxed. Only the specific operations you grant permission for (via capabilities) cross the bridge.
- **The messages are JSON.** Tauri serializes your function call into JSON, sends it across, and deserializes the response. This is all handled automatically by the plugin system.

### How it works in practice

```txt
1. React:    await db.execute("INSERT INTO todos (text) VALUES (?)", ["hello"])
                  │
2. JS plugin:    invoke("plugin:sql|execute", {
                   db: "sqlite:todo.db",
                   sql: "INSERT INTO todos (text) VALUES (?)",
                   params: ["hello"]
                 })
                  │
3. [JSON message crosses IPC bridge]
                  │
4. Rust gate:    Check capabilities → "sql:allow-execute" ✓
                  │
5. Rust plugin:  sqlite3_exec(db, "INSERT INTO todos...")
                  │
6. Rust → JS:    { lastInsertId: 4, rowsAffected: 1 }
                  │
7. React:        const id = result.lastInsertId  // 4
```

The developer only writes step 1 and 7. Steps 2–6 are handled by `@tauri-apps/plugin-sql` (JS side) and `tauri-plugin-sql` (Rust side). You call a JavaScript function, and the plugin handles the rest.

### No IPC needed for local operations

Not everything crosses the bridge. Filtering todos (`setFilter("active")`) is pure React state. No message is sent. The rule is: if React can do it with its own state or browser APIs, no IPC. If it needs the OS (filesystem, database, native window), IPC.

---

## Scenario 1 — App Cold Start

```txt
$ npm run tauri dev   (or double-click todo-new.exe)
  │
  ├── tauri.conf.json → beforeDevCommand: "npm run dev"
  │     └── Starts Vite dev server on localhost:1420
  │           ├── vite.config.ts: strictPort true, port 1420
  │           └── HMR via TAURI_DEV_HOST env var (ws://host:1421)
  │
  ├── Cargo compiles todo_new_lib (debug profile)
  │     └── No .cargo/config.toml → uses default MSVC toolchain
  │           └── Requires: VS Build Tools with cl.exe + link.exe
  │
  └── main.rs::main()
        │
        └── todo_new_lib::run()
              │
              ├── Migration v1 defined
              │     └── CREATE TABLE IF NOT EXISTS todos (
              │           id INTEGER PRIMARY KEY AUTOINCREMENT,
              │           text TEXT NOT NULL,
              │           completed INTEGER NOT NULL DEFAULT 0,
              │           created_at TEXT NOT NULL DEFAULT (datetime('now'))
              │         )
              │
              ├── tauri::Builder::default()
              │     │
              │     ├── .plugin(tauri_plugin_sql::Builder)
              │     │     └── .add_migrations("sqlite:todo.db", migrations)
              │     │           └── MigrationRunner runs on first connect
              │     │
              │     └── .run(tauri::generate_context!())
              │           │
              │           ├── Embeds tauri.conf.json (compile-time)
              │           │     ├── identifier: "com.fajarwz.todo-tauri"
              │           │     ├── window: 800×600, title="todo-new"
              │           │     └── bundle: active, targets="all"
              │           │
              │           ├── Loads capabilities/default.json
              │           │     └── Permissions:
              │           │           core:default
              │           │           sql:default, sql:allow-{load,execute,select,close}
              │           │
              │           └── Opens WebView2 window
              │                 └── dev: loads http://localhost:1420
              │                     prod: loads embedded dist/index.html
              │
              └── MigrationRunner (async, after WebView ready)
                    ├── No _sqlx_migrations table → CREATE it
                    └── Applies v1 → CREATE TABLE todos
```

```txt
React mount (inside WebView)
  │
  └── src/main.tsx
        └── ReactDOM.createRoot → <App />
              │
              └── App.tsx mount
                    │
                    ├── State init:
                    │     ├── todos = []
                    │     ├── newText = ""
                    │     ├── filter = "all"
                    │     ├── db = null
                    │     ├── loading = true
                    │     └── error = null
                    │
                    └── useEffect(fn, [])  fires once
                          └── initDb()
                                │
                                ├── await Database.load("sqlite:todo.db")
                                │     │
                                │     ├── JS: @tauri-apps/plugin-sql
                                │     │     └── invoke("plugin:sql|load", {...})
                                │     │
                                │     ├── [IPC Bridge]
                                │     │     └── Rust: tauri-plugin-sql
                                │     │           ├── Capability check: sql:allow-load ✓
                                │     │           ├── Resolves: %APPDATA%/com.fajarwz.todo-tauri/todo.db
                                │     │           ├── Opens SQLite (creates file if missing)
                                │     │           └── Returns connection handle → JS
                                │     │
                                │     └── setDb(database)
                                │
                                ├── await database.select(
                                │       "SELECT * FROM todos ORDER BY created_at DESC"
                                │     )
                                │     │
                                │     ├── JS → IPC → Rust: sql:allow-select ✓
                                │     └── Returns Todo[] (empty on first launch)
                                │
                                ├── setTodos(rows)
                                │     └── React state = persisted rows from DB
                                │
                                └── setLoading(false)
                                      └── Spinner hidden, main UI renders

Note: This project's initDb() does NOT run CREATE TABLE.
      Table creation is handled entirely by the Rust migration (v1).
      Separation of concerns: Rust owns schema, JS only reads/writes data.
```

---

## Scenario 2 — Create Todo

```txt
User types "Learn Tauri" in input
  │
  └── onChange → setNewText("Learn Tauri")
        └── Button enabled (text.trim() is truthy)

User presses Enter
  │
  └── onKeyDown → e.key === "Enter" → addTodo()

addTodo()  [useCallback, deps: db, newText]
  │
  ├── GUARD: !db → return (null guard)
  ├── GUARD: !newText.trim() → return (button already disabled)
  │
  ├── await db.execute(
  │       "INSERT INTO todos (text) VALUES (?)",
  │       ["Learn Tauri"]
  │     )
  │     │
  │     ├── JS → IPC → Rust: sql:allow-execute ✓
  │     ├── Rust → SQLite: INSERT INTO todos (text) VALUES ('Learn Tauri')
  │     │     ├── id = AUTOINCREMENT (e.g., 3)
  │     │     ├── completed = 0 (DEFAULT)
  │     │     └── created_at = datetime('now') (DEFAULT)
  │     └── Returns → JS: { lastInsertId: 3, rowsAffected: 1 }
  │
  ├── const id = result.lastInsertId  // 3
  │
  ├── await db.select(
  │       "SELECT * FROM todos WHERE id = ?",
  │       [3]
  │     )
  │     │
  │     ├── JS → IPC → Rust: sql:allow-select ✓
  │     └── Returns: [{ id:3, text:"Learn Tauri", completed:0, created_at:"..." }]
  │
  ├── setTodos(prev => [newRow, ...prev])
  │     └── Prepend to list (newest on top, ORDER BY created_at DESC)
  │
  └── setNewText("")
        └── Input cleared, UI re-renders

Side effects:
  ├── filtered recomputed → new todo appears (filter="all")
  ├── remaining recomputed → count += 1
  └── Status bar: "2 items remaining"
```

---

## Scenario 3 — Toggle Todo Completion

```txt
User clicks checkbox on todo id=3
  │
  └── onChange → toggleTodo(todo)   // todo.completed = 0

toggleTodo()  [useCallback, deps: db]
  │
  ├── GUARD: !db → return
  │
  ├── const newCompleted = todo.completed ? 0 : 1
  │     ├── current = 0 → newCompleted = 1 (mark done)
  │     └── current = 1 → newCompleted = 0 (mark active)
  │
  ├── await db.execute(
  │       "UPDATE todos SET completed = ? WHERE id = ?",
  │       [1, 3]
  │     )
  │     ├── JS → IPC → Rust: sql:allow-execute ✓
  │     └── Rust → SQLite: UPDATE todos SET completed=1 WHERE id=3
  │           └── { rowsAffected: 1 }
  │
  └── setTodos(prev =>
        prev.map(t => t.id === 3 ? { ...t, completed: 1 } : t)
      )
        │
        └── Optimistic update — no DB re-fetch needed
              ├── CSS: .completed class → text strikethrough
              ├── remaining decrements
              └── If filter="active" → item hides immediately
```

---

## Scenario 4 — Delete Single Todo

```txt
User clicks × on todo id=3
  │
  └── onClick → deleteTodo(3)

deleteTodo()  [useCallback, deps: db]
  │
  ├── GUARD: !db → return
  │
  ├── await db.execute("DELETE FROM todos WHERE id = ?", [3])
  │     ├── JS → IPC → Rust: sql:allow-execute ✓
  │     └── Rust → SQLite: DELETE FROM todos WHERE id=3
  │           └── { rowsAffected: 1 }
  │
  └── setTodos(prev => prev.filter(t => t.id !== 3))
        └── React re-renders without row id=3
```

---

## Scenario 5 — Clear All Completed

```txt
User clicks "Clear completed" button
  │
  ├── GUARD: button visible only when (todos.length - remaining > 0)
  │
  └── clearCompleted()

clearCompleted()  [useCallback, deps: db]
  │
  ├── GUARD: !db → return
  │
  ├── await db.execute("DELETE FROM todos WHERE completed = 1")
  │     ├── JS → IPC → Rust: sql:allow-execute ✓
  │     └── Bulk DELETE — all completed rows removed
  │
  └── setTodos(prev => prev.filter(t => !t.completed))
        └── "Clear completed" button hides (no completed left)
```

---

## Scenario 6 — Client-Side Filtering (zero IPC)

```txt
User clicks "Active" filter
  │
  └── setFilter("active")
        │
        └── React re-renders
              │
              └── filtered = todos.filter(t => {
                    if (filter === "active") return !t.completed
                    // t.completed === 0 → shown
                    // t.completed === 1 → hidden
                  })
                    │
                    ├── No IPC, no SQL WHERE, no Rust call
                    └── Pure JS Array.filter() on existing state

Filter states:
  ├── "all"       → return true          (no filter)
  ├── "active"    → return !t.completed  (completed === 0)
  └── "completed" → return !!t.completed (completed === 1)
```

---

## Scenario 7 — Error Handling

```txt
Any IPC operation rejects:
  │
  └── catch (e)
        └── setError(String(e))
              │
              └── React skips normal render, shows:
                    ├── ⚠️ icon
                    ├── "Database error" (red, var(--danger))
                    └── error detail string

Error triggers:
  ├── Capability missing (e.g., sql:allow-execute not granted)
  ├── SQLite file locked by another process
  ├── Disk full
  ├── WebView2 crash / IPC bridge broken
  └── Malformed SQL

Recovery: close and reopen app. DB file persists on disk.
```

---

## Scenario 8 — Dev Mode Hot Reload (TAURI_DEV_HOST)

```txt
$ npm run tauri dev
  │
  ├── tauri.conf.json: beforeDevCommand = "npm run dev"
  │     └── Vite starts
  │           ├── host = process.env.TAURI_DEV_HOST (set by Tauri CLI)
  │           ├── HMR WebSocket: ws://{host}:1421
  │           ├── server.port: 1420 (strictPort: true)
  │           └── watch.ignored: ["**/src-tauri/**"]
  │
  └── Tauri opens window → loads http://localhost:1420

Edit src/App.tsx:
  └── Vite HMR → updated module pushed via WebSocket
        └── React re-renders in-place, state preserved

Edit src-tauri/src/lib.rs:
  └── Vite ignores (watch.ignored)
  └── Cargo recompiles → Tauri restarts window
        └── State lost (new process)
```

---

## Scenario 9 — Production Build

```txt
$ npm run tauri build
  │
  ├── beforeBuildCommand: "npm run build"
  │     ├── tsc (TypeScript 5.8 type-check)
  │     └── vite build (Vite 7 bundles)
  │           └── Output: dist/
  │                 ├── index.html
  │                 ├── assets/index-*.css
  │                 └── assets/index-*.js
  │
  ├── Cargo build --release
  │     └── Compiles Rust with optimizations
  │           └── tauri::generate_context!() embeds dist/
  │
  └── Bundle (tauri.conf.json → bundle.targets = "all")
        ├── src-tauri/target/release/todo-new.exe    (standalone binary)
        ├── src-tauri/target/release/bundle/nsis/    (NSIS installer)
        │     └── todo-new_0.1.0_x64-setup.exe
        └── src-tauri/target/release/bundle/msi/     (MSI installer)
```

---

## Scenario 10 — Capability Permission Gate

```txt
invoke("plugin:sql|load", { db: "sqlite:todo.db" })
  │
  └── Tauri runtime: permission check
        │
        ├── Reads capabilities/default.json
        │     └── permissions: [
        │           "core:default",
        │           "sql:default", "sql:allow-load",
        │           "sql:allow-execute", "sql:allow-select",
        │           "sql:allow-close"
        │         ]
        │
        ├── "sql:allow-load" in list → ✓ ALLOW
        │     └── Forward to sql plugin handler
        │
        └── Missing → ✗ DENY
              └── Error returned to JS (catched by initDb catch block)

Required per operation:
  ├── Database.load()       → sql:allow-load
  ├── db.execute()          → sql:allow-execute
  ├── db.select()           → sql:allow-select
  └── db.close()            → sql:allow-close

sql:default preset includes: { allow-close, allow-load, allow-select }
  └── MUST add sql:allow-execute explicitly for INSERT/UPDATE/DELETE
```

---

## Scenario 11 — SQLite File Lifecycle

```txt
Platform path (identifier: com.fajarwz.todo-tauri):
  ├── Windows: %APPDATA%/com.fajarwz.todo-tauri/todo.db
  ├── macOS:   ~/Library/Application Support/com.fajarwz.todo-tauri/todo.db
  └── Linux:   ~/.local/share/com.fajarwz.todo-tauri/todo.db

First launch:
  └── Database.load("sqlite:todo.db")
        └── Rust: sqlite3_open() creates empty todo.db
              └── MigrationRunner: runs v1 → CREATE TABLE todos

Subsequent launches:
  └── Database.load() → opens existing file
        └── MigrationRunner checks _sqlx_migrations
              ├── v1 already applied → skip
              └── New version (v2) → apply

Tables in todo.db:
  ├── todos
  │     ├── id INTEGER PK AUTOINCREMENT
  │     ├── text TEXT NOT NULL
  │     ├── completed INTEGER DEFAULT 0
  │     └── created_at TEXT DEFAULT datetime('now')
  └── _sqlx_migrations
        ├── version INTEGER PK
        ├── description TEXT
        ├── installed_on TEXT
        └── success BOOLEAN
```

---

## Key State Variables

```txt
React State (App.tsx):
  ├── todos: Todo[]               Source of truth after DB load
  ├── newText: string             Controlled input, cleared after add
  ├── filter: Filter              Client-only, no DB involvement
  ├── db: Database | null         null → spinner, Database → ready
  ├── loading: boolean            true during initDb(), false after
  └── error: string | null        null = ok, string = error screen

Derived (recomputed every render):
  ├── filtered: Todo[]            = todos.filter(by filter state)
  └── remaining: number           = todos.filter(t => !t.completed).length

Rust State (lib.rs):
  └── migrations: Vec<Migration>  Applied once at startup, not mutated

Database (SQLite file):
  ├── todos table                 User data
  ├── _sqlx_migrations table      Migration tracking (version, installed_on)
  └── sqlite_sequence             AUTOINCREMENT counter
```

---

## IPC Message Map

```
JS API                              IPC Command            Permission Required
────────────────────────────────────────────────────────────────────────────
Database.load("sqlite:todo.db")     plugin:sql|load        sql:allow-load
db.execute(sql, params)             plugin:sql|execute     sql:allow-execute
db.select(sql, params)              plugin:sql|select      sql:allow-select
db.close()                          plugin:sql|close       sql:allow-close
```

All IPC messages: JSON-serialized, pass through Tauri permission gate, forwarded to `tauri-plugin-sql` Rust handler.

---

## File Role Summary

| File | Role |
|------|------|
| `package.json` | npm scripts + JS deps (React 19, Vite 7, plugin-sql, plugin-opener) |
| `index.html` | Vite HTML entry — loads `/src/main.tsx` |
| `vite.config.ts` | Vite 7 config — port 1420, TAURI_DEV_HOST HMR, React plugin |
| `tsconfig.json` | TypeScript 5.8 config |
| `src/main.tsx` | React mount point — renders `<App />` into #root |
| `src/App.tsx` | Core app — state, initDb, CRUD, filters, rendering (~250 lines) |
| `src/App.css` | Dark theme UI — CSS custom properties, ~220 lines |
| `src/vite-env.d.ts` | Vite type declarations |
| `assets/images/app.png` | App screenshot for README |
| `src-tauri/Cargo.toml` | Rust manifest — tauri 2, plugin-sql (sqlite), plugin-opener |
| `src-tauri/build.rs` | Build script — tauri_build::build() (embeds config + icons) |
| `src-tauri/tauri.conf.json` | App config — window 800×600, identifier, bundle targets |
| `src-tauri/capabilities/default.json` | Permission grants — sql:allow-load/execute/select/close |
| `src-tauri/src/main.rs` | Binary entry — calls todo_new_lib::run(), hides console on release |
| `src-tauri/src/lib.rs` | App setup — registers SQL plugin with migration v1 |
| `README.md` | Project docs with dev/build/run instructions |

