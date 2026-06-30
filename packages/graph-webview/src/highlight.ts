import hljs from "highlight.js";

/**
 * Syntax highlighting for the diff view, powered by highlight.js (all bundled
 * languages). The language is picked from the file's extension/name — exactly
 * like an IDE — and the whole file is highlighted in one pass so multi-line
 * constructs (block comments, template strings) colour correctly, then the
 * coloured HTML is split into per-line fragments that drop straight into the
 * existing one-cell-per-line diff grid.
 *
 * The returned strings are HTML: every bit of source text is escaped by
 * highlight.js, and the only tags are highlight.js's own `<span class="hljs-…">`
 * wrappers, so it is safe to assign via `innerHTML`.
 */

/**
 * Extensions whose highlight.js language id differs from the extension itself.
 * Extensions that already equal a known language alias (js, ts, py, rb, cs,
 * cpp, rs, go, php, sql, json, xml, css, scss, yaml, md, …) are resolved
 * directly by {@link hljs.getLanguage} and need no entry here.
 */
const EXT_TO_LANG: Record<string, string> = {
  // JS/TS family
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  // C / C++ headers and variants
  h: "cpp",
  hpp: "cpp",
  hh: "cpp",
  hxx: "cpp",
  cc: "cpp",
  cxx: "cpp",
  "c++": "cpp",
  // web / markup
  htm: "xml",
  xhtml: "xml",
  vue: "xml",
  svg: "xml",
  svelte: "xml",
  cshtml: "xml",
  razor: "xml",
  // shells
  sh: "bash",
  zsh: "bash",
  bash: "bash",
  ksh: "bash",
  // config / data
  yml: "yaml",
  toml: "ini",
  cfg: "ini",
  conf: "ini",
  jsonc: "json",
  json5: "json",
  // misc languages
  kt: "kotlin",
  kts: "kotlin",
  rs: "rust",
  py: "python",
  pyw: "python",
  rb: "ruby",
  pl: "perl",
  pm: "perl",
  ps1: "powershell",
  psm1: "powershell",
  gradle: "groovy",
  groovy: "groovy",
  scala: "scala",
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  clj: "clojure",
  cljs: "clojure",
  dart: "dart",
  hs: "haskell",
  lua: "lua",
  r: "r",
  jl: "julia",
  m: "objectivec",
  mm: "objectivec",
  swift: "swift",
  vb: "vbnet",
  fs: "fsharp",
  fsx: "fsharp",
  proto: "protobuf",
  tf: "terraform",
  tsv: "plaintext",
  md: "markdown",
  markdown: "markdown",
  tex: "latex",
  styl: "stylus",
  less: "less",
  bat: "dos",
  cmd: "dos",
  ino: "cpp",
};

/** Bare filenames (no useful extension) that map to a language. */
const NAME_TO_LANG: Record<string, string> = {
  dockerfile: "dockerfile",
  containerfile: "dockerfile",
  makefile: "makefile",
  "cmakelists.txt": "cmake",
  gnumakefile: "makefile",
  "gemfile": "ruby",
  "rakefile": "ruby",
  "vagrantfile": "ruby",
  ".gitignore": "bash",
  ".gitattributes": "bash",
  ".bashrc": "bash",
  ".zshrc": "bash",
  ".profile": "bash",
  ".env": "bash",
};

/** Resolve a file path to a highlight.js language id, or null if unknown. */
export function languageForPath(path: string): string | null {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const base = path.slice(slash + 1).toLowerCase();

  const byName = NAME_TO_LANG[base];
  if (byName && hljs.getLanguage(byName)) return byName;

  const dot = base.lastIndexOf(".");
  if (dot <= 0) {
    // No extension (e.g. "Dockerfile" already handled, "LICENSE" → none).
    return hljs.getLanguage(base) ? base : null;
  }
  const ext = base.slice(dot + 1);

  const mapped = EXT_TO_LANG[ext];
  if (mapped && hljs.getLanguage(mapped)) return mapped;
  // Many extensions are themselves registered language ids/aliases.
  if (hljs.getLanguage(ext)) return ext;
  return null;
}

/** HTML-escape a raw source line (used when no language is known). */
function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}

/** Split text into lines the same way the diff does: "" → none, drop one trailing "\n". */
function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * Split a highlight.js HTML string into one self-contained fragment per source
 * line. highlight.js emits literal "\n" between lines and never splits a tag
 * across one, so we walk the string tracking the stack of open `<span>` tags:
 * at each newline we close every open span (so the line is valid on its own)
 * and re-open the same stack on the next line. This keeps multi-line tokens
 * (block comments, template literals) coloured on every line they span.
 */
function splitHighlightedLines(html: string): string[] {
  const lines: string[] = [];
  const open: string[] = []; // stack of opening "<span …>" tags currently in effect
  let cur = "";
  let i = 0;
  while (i < html.length) {
    const ch = html[i];
    if (ch === "<") {
      const end = html.indexOf(">", i);
      const tag = end < 0 ? html.slice(i) : html.slice(i, end + 1);
      if (tag.startsWith("</")) open.pop();
      else open.push(tag);
      cur += tag;
      i += tag.length;
    } else if (ch === "\n") {
      cur += "</span>".repeat(open.length); // close open spans to end the line cleanly
      lines.push(cur);
      cur = open.join(""); // re-open them so the next line continues the same tokens
      i++;
    } else {
      let j = i;
      while (j < html.length && html[j] !== "<" && html[j] !== "\n") j++;
      cur += html.slice(i, j);
      i = j;
    }
  }
  lines.push(cur);
  return lines;
}

/**
 * Highlight a file's text and return one HTML fragment per line, aligned with
 * the diff's line numbering ({@link splitLines}). Falls back to plain escaped
 * lines when the language is unknown or highlighting throws.
 */
export function highlightToLines(text: string, path: string): string[] {
  if (text === "") return [];
  const body = text.replace(/\n$/, "");
  const lang = languageForPath(path);
  if (!lang) return splitLines(text).map(escapeHtml);
  try {
    const value = hljs.highlight(body, { language: lang, ignoreIllegal: true }).value;
    return splitHighlightedLines(value);
  } catch {
    return splitLines(text).map(escapeHtml);
  }
}
