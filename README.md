## Todo Tauri

A Todo app built with [Tauri](https://tauri.app)

I wrote a step-by-step developer blog article explaining how this app was built with Tauri, React, Rust, and SQLite:

👉 https://fajarwz.com/blog/create-your-first-tauri-app/

The article covers:
- setting up Tauri on Windows
- fixing common MSVC/linker issues
- configuring SQLite
- Tauri capabilities and permissions
- Rust migrations
- React integration
- building the final desktop executable

## Development

Install dependencies:

```bash
npm install
```

Run the app in development mode:

```bash
npm run tauri dev
```

This starts:
- the Vite frontend dev server
- the Rust backend
- the desktop application window

If everything works correctly, the Tauri app window should appear automatically.

## Build Production App

Build the production desktop application:

```bash
npm run tauri build
```

After the build finishes, the generated files will appear inside:

```txt
src-tauri/target/release/bundle/
```

Common Windows outputs:

```txt
src-tauri/target/release/bundle/nsis/
src-tauri/target/release/bundle/msi/
```

Example generated installer:

```txt
todo-new_0.1.0_x64-setup.exe
```

Tauri also generates the raw executable binary here:

```txt
src-tauri/target/release/todo-new.exe
```

## Run the Executable Directly

You can run the app directly without installing it by opening:

```txt
src-tauri/target/release/todo-new.exe
```

Or from terminal:

```bash
./src-tauri/target/release/todo-new.exe
```

## Tech Stack

- Tauri v2
- React
- TypeScript
- SQLite
- Rust
- Vite

## Notes

The SQLite database is automatically stored in the application data directory.

On Windows, it is usually located around:

```txt
C:\Users\<YOUR_USERNAME>\AppData\Roaming\<bundle-identifier>\todo.db
```

This project uses:
- Tauri SQL Plugin
- SQLite migrations
- Tauri capabilities/permissions system

## Learn More

- [Tauri Documentation](https://tauri.app)
- [Tauri GitHub Repository](https://github.com/tauri-apps/tauri)
- [create-tauri-app](https://github.com/tauri-apps/create-tauri-app)
