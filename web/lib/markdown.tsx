import { Fragment, useState, type ReactNode } from "react";

const inlinePattern = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|\[[^\]]+\]\([^)]+\))/g;

const inline = (text: string, keyPrefix: string): ReactNode[] => {
  const parts = text.split(inlinePattern);
  return parts.map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={key}>{part.slice(1, -1)}</code>;
    if ((part.startsWith("**") && part.endsWith("**")) || (part.startsWith("__") && part.endsWith("__"))) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    if ((part.startsWith("*") && part.endsWith("*")) || (part.startsWith("_") && part.endsWith("_"))) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) return <a key={key} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>;
    return <Fragment key={key}>{part}</Fragment>;
  });
};

const CodeBlock = ({ language, code }: { language: string; code: string }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  return (
    <div className="code-block">
      <div className="code-bar">
        <span>{language || "code"}</span>
        <button type="button" onClick={copy}>{copied ? "copied" : "copy"}</button>
      </div>
      <pre><code>{code}</code></pre>
    </div>
  );
};

const renderLine = (line: string, key: string) => {
  const heading = line.match(/^(#{1,3})\s+(.*)$/);
  if (heading) {
    const Tag = (`h${heading[1].length}` as "h1" | "h2" | "h3");
    return <Tag key={key}>{inline(heading[2], key)}</Tag>;
  }
  return <p key={key}>{inline(line, key)}</p>;
};

const renderList = (items: string[], ordered: boolean, key: string) => {
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag key={key}>
      {items.map((item, index) => <li key={`${key}-${index}`}>{inline(item, `${key}-${index}`)}</li>)}
    </Tag>
  );
};

export function Markdown({ text }: { text: string }) {
  const chunks = text.replace(/\r\n/g, "\n").split(/```/);
  const nodes: ReactNode[] = [];

  chunks.forEach((chunk, index) => {
    if (index % 2 === 1) {
      const newline = chunk.indexOf("\n");
      const language = newline === -1 ? "" : chunk.slice(0, newline).trim();
      const code = (newline === -1 ? chunk : chunk.slice(newline + 1)).replace(/\n$/, "");
      nodes.push(<CodeBlock key={`code-${index}`} language={language} code={code} />);
      return;
    }

    const lines = chunk.split("\n");
    let list: string[] = [];
    let ordered = false;
    let paragraph: string[] = [];

    const flushList = () => {
      if (!list.length) return;
      nodes.push(renderList(list, ordered, `list-${index}-${nodes.length}`));
      list = [];
    };
    const flushParagraph = () => {
      if (!paragraph.length) return;
      const body = paragraph.join("\n");
      nodes.push(renderLine(body, `p-${index}-${nodes.length}`));
      paragraph = [];
    };

    lines.forEach((line) => {
      const bullet = line.match(/^\s*[-*]\s+(.*)$/);
      const number = line.match(/^\s*\d+\.\s+(.*)$/);
      if (bullet || number) {
        flushParagraph();
        const nextOrdered = Boolean(number);
        if (list.length && nextOrdered !== ordered) flushList();
        ordered = nextOrdered;
        list.push((bullet?.[1] ?? number?.[1] ?? "").trim());
        return;
      }
      if (!line.trim()) {
        flushList();
        flushParagraph();
        return;
      }
      if (line.startsWith("#")) {
        flushList();
        flushParagraph();
        nodes.push(renderLine(line, `h-${index}-${nodes.length}`));
        return;
      }
      flushList();
      paragraph.push(line);
    });
    flushList();
    flushParagraph();
  });

  return <div className="md">{nodes}</div>;
}
