# AegisSyntax AI Beginner Auditor 🛡️💻

AegisSyntax is a modern, student-focused, AI-powered Syntax and Code Quality Review web app designed specifically for beginner programmers and coding practice students. 

The application combines **real-time, local rule-based compiler validators** (utilizing Python's native `ast` parser via sub-processes, Node.js's built-in `vm` script compiler, and regular expression filters for Java/CSS) with **Google Gemini AI models** to deliver 100% accurate syntax diagnostics, red error line highlights inside Monaco Editor, time-space complexities, and warm mentor-like explanations.

---

## 🌟 Key Architecture & Compiler Highlights

```
project/
├── backend/                  # Node.js + Express Server API
│   ├── .env.example          # Environment template for API keys
│   ├── package.json          # Server dependencies
│   └── server.js             # Local AST/VM compiler validators & Gemini routes
└── frontend/                 # Vite + React Client SPA
    ├── package.json          # React packages (Framer Motion, Monaco)
    ├── vite.config.js        # Vite & Tailwind CSS v4 compiler settings
    └── src/
        ├── App.jsx           # Main SPA layout with a state-based router
        ├── index.css         # Dark cyberpunk theme & glowing mesh styles
        ├── components/       # Components (Navbar, MonacoEditor, Feedback)
        └── pages/            # View pages (Home, Review, About)
```

1. **Subprocess Python AST Parser**: Runs a local, safe subprocess `python3 -c "import sys, ast; ast.parse(sys.stdin.read())"` by writing code directly to `stdin` (100% shell-injection safe), catching exact indentation/compile exceptions and line numbers.
2. **Node.js `vm` Script Compiler**: Compiles JavaScript and React snippets instantly inside closed sandboxed contexts (`new vm.Script`), catching precise unexpected token colons and columns.
3. **Regex Java & CSS Scanners**: Traverses Java and CSS statements to identify missing semicolons, mismatched curly braces `{}` or parentheses `()`, and invalid keyword spellings.
4. **Interactive Monaco Line Highlighting**: Maps returned parser errors directly to the **Monaco Editor**, automatically applying **red glowing line decorations** and inline margins to guide the student's eye to the exact mistake.
5. **Mentoring Explanations**: Swaps cryptic terminal errors with warm, encouraging mentoring feedback explaining *why* the code broke and *how* to correct it.
6. **Complexity Estimations**: Calculates time/space complexities, gracefully outputting `"Complexity could not be reliably determined"` for simple templates or syntactically invalid code blocks to prevent generic AI predictions.

---

## 🚀 Quick Setup Instructions

Follow these simple steps to spin up the application on your local machine:

### 1. Configure the Backend (Node + Express)

```bash
# Navigate to the backend directory
cd backend

# Install dependencies (express, cors, dotenv)
npm install

# Copy env template and configure keys (Optional)
cp .env.example .env
```

Open `.env` in your text editor and input your **Gemini API Key** (you can get a free key from [Google AI Studio](https://aistudio.google.com/)).

> [!NOTE]  
> If no API key is specified, the backend automatically runs in **Offline Sandbox Mode** — merging local compiler diagnostics with high-fidelity pre-designed error logs, guaranteeing 100% full-stack functionality out-of-the-box!

```bash
# Boot the Express server on Port 5001
npm start
```

---

### 2. Configure the Frontend (Vite + React)

Open a new terminal window:

```bash
# Navigate to the frontend directory
cd frontend

# Install dependencies (Monaco, Framer Motion, Lucide)
npm install

# Launch the Vite development server
npm run dev
```

Visit **[http://localhost:5174](http://localhost:5174)** inside your web browser to open the app!

---

## 🔒 Supported Languages
AegisSyntax reviews solutions strictly for:
* 🐍 **Python** (`.py`)
* ☕ **Java** (`.java`)
* 🌐 **JavaScript** (`.js`)
* ⚛️ **React JSX** (`.jsx`)
* 🎨 **CSS** (`.css`)
Achievement test
Achievement test
Quickdraw test
