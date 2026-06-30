// Mock GraphData for the browser harness — a small repo with a feature branch,
// a merge, a tag, and local + remote refs, to exercise the layout & colors.
window.__MOCK_GRAPH__ = {
  repoName: "demo-repo",
  gitCommand: "git log --exclude=refs/stash --all --topo-order --max-count=500",
  head: "h7777777",
  commits: [
    { sha: "h7777777", parents: ["h6666666", "f2222222"], summary: "Merge feature/login", author: "Ben", authorEmail: "ben@example.com", date: "2026-06-25T10:00:00Z" },
    { sha: "f2222222", parents: ["f1111111"], summary: "Add login form validation", author: "Ben", authorEmail: "ben@example.com", date: "2026-06-24T15:00:00Z" },
    { sha: "h6666666", parents: ["h5555555"], summary: "Update README", author: "Ana", authorEmail: "ana@example.com", date: "2026-06-24T12:00:00Z" },
    { sha: "f1111111", parents: ["h5555555"], summary: "Scaffold login page", author: "Ben", authorEmail: "ben@example.com", date: "2026-06-23T09:00:00Z" },
    { sha: "h5555555", parents: ["h4444444"], summary: "Release 1.0.0", author: "Ana", authorEmail: "ana@example.com", date: "2026-06-22T18:00:00Z" },
    { sha: "h4444444", parents: ["h3333333"], summary: "Fix crash on startup", author: "Ben", authorEmail: "ben@example.com", date: "2026-06-21T11:00:00Z" },
    { sha: "h3333333", parents: [], summary: "Initial commit", author: "Ana", authorEmail: "ana@example.com", date: "2026-06-20T08:00:00Z" },
    // Newest commit by date, but on a side branch forked from the old h4444444 —
    // it must sit next to its fork, NOT jump to the top.
    { sha: "t1111111", parents: ["h4444444"], summary: "WIP on test branch", author: "Ben", authorEmail: "ben@example.com", date: "2026-06-27T18:00:00Z" },
  ],
  refs: [
    { name: "main", type: "localBranch", targetSha: "h7777777" },
    // Brand-new branch created off main's tip — no commits of its own yet, so it
    // shares main's commit. It must appear in its own lane to the right.
    { name: "feature/brand-new", type: "localBranch", targetSha: "h7777777", isCurrent: true },
    { name: "head", type: "head", targetSha: "h7777777" },
    { name: "origin/main", type: "remoteBranch", targetSha: "h6666666", remote: "origin" },
    { name: "feature/login", type: "localBranch", targetSha: "f2222222" },
    { name: "origin/feature/login", type: "remoteBranch", targetSha: "f1111111", remote: "origin" },
    { name: "v1.0.0", type: "tag", targetSha: "h5555555" },
    { name: "release/1.0", type: "localBranch", targetSha: "h5555555" },
    { name: "origin/release/1.0", type: "remoteBranch", targetSha: "h5555555", remote: "origin" },
    { name: "test/1.31", type: "localBranch", targetSha: "t1111111" },
  ],
  // Two stashes from different base commits — drawn in their own column.
  stashes: [
    { index: 0, sha: "s0000000", baseSha: "h7777777", message: "WIP on main: tidy header", date: "2026-06-26T09:00:00Z" },
    { index: 1, sha: "s1111111", baseSha: "h5555555", message: "WIP on release/1.0: hotfix", date: "2026-06-23T14:00:00Z" },
  ],
};

// Per-commit file changes for the "View changes…" dialog. The real hosts compute
// these from git; here they're hand-authored so the demo shows added / modified /
// deleted / renamed files and a side-by-side diff with no git backend.
window.__MOCK_CHANGES__ = {
  f1111111: [
    {
      path: "src/login/LoginPage.tsx",
      status: "added",
      oldText: "",
      newText:
        "export function LoginPage() {\n" +
        "  return (\n" +
        "    <form>\n" +
        "      <input name=\"email\" />\n" +
        "      <input name=\"password\" type=\"password\" />\n" +
        "      <button>Sign in</button>\n" +
        "    </form>\n" +
        "  );\n" +
        "}\n",
    },
    {
      path: "src/routes.ts",
      status: "modified",
      oldText: "export const routes = [\n  { path: \"/\", page: \"Home\" },\n];\n",
      newText:
        "export const routes = [\n" +
        "  { path: \"/\", page: \"Home\" },\n" +
        "  { path: \"/login\", page: \"LoginPage\" },\n" +
        "];\n",
    },
  ],
  f2222222: [
    {
      path: "src/login/LoginPage.tsx",
      status: "modified",
      oldText:
        "export function LoginPage() {\n" +
        "  return (\n" +
        "    <form>\n" +
        "      <input name=\"email\" />\n" +
        "      <input name=\"password\" type=\"password\" />\n" +
        "      <button>Sign in</button>\n" +
        "    </form>\n" +
        "  );\n" +
        "}\n",
      newText:
        "export function LoginPage() {\n" +
        "  const [error, setError] = useState(\"\");\n" +
        "  function validate(email) {\n" +
        "    if (!email.includes(\"@\")) setError(\"Invalid email\");\n" +
        "  }\n" +
        "  return (\n" +
        "    <form>\n" +
        "      <input name=\"email\" onBlur={e => validate(e.target.value)} />\n" +
        "      <input name=\"password\" type=\"password\" />\n" +
        "      {error && <p className=\"err\">{error}</p>}\n" +
        "      <button>Sign in</button>\n" +
        "    </form>\n" +
        "  );\n" +
        "}\n",
    },
    {
      path: "src/login/validation.ts",
      status: "added",
      oldText: "",
      newText:
        "export function isEmail(v) {\n  return /^[^@]+@[^@]+$/.test(v);\n}\n",
    },
    {
      path: "src/login/legacy-auth.js",
      status: "deleted",
      oldText: "// old auth flow\nexport function authOld() {\n  return false;\n}\n",
      newText: "",
    },
  ],
  h6666666: [
    {
      path: "docs/README.md",
      oldPath: "README.md",
      status: "renamed",
      oldText: "# Demo Repo\n\nA tiny example.\n",
      newText: "# Demo Repo\n\nA tiny example project.\n\n## Usage\n\nRun `npm start`.\n",
    },
  ],
  h3333333: [
    {
      path: "README.md",
      status: "added",
      oldText: "",
      newText: "# Demo Repo\n\nA tiny example.\n",
    },
    {
      path: "package.json",
      status: "added",
      oldText: "",
      newText: "{\n  \"name\": \"demo-repo\",\n  \"version\": \"0.1.0\"\n}\n",
    },
  ],
};
