import { useMemo, useState } from "react";

const copy = (value: string) => navigator.clipboard.writeText(value);

export function DocsPage() {
  const origin = typeof window === "undefined" ? "http://localhost:3001" : window.location.origin;
  const base = `${origin}/v1`;
  const [copied, setCopied] = useState("");

  const samples = useMemo(() => ({
    python: `from openai import OpenAI

client = OpenAI(
    base_url="${base}",
    api_key="uai_...",
)

completion = client.chat.completions.create(
    model="unabridged",
    messages=[
        {"role": "system", "content": "Be concise."},
        {"role": "user", "content": "Hello."},
    ],
)
print(completion.choices[0].message.content)`,
    stream: `stream = client.chat.completions.create(
    model="unabridged",
    messages=[{"role": "user", "content": "Hello."}],
    stream=True,
)
for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="")`,
    node: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${base}",
  apiKey: "uai_...",
});

const stream = await client.chat.completions.create({
  model: "unabridged",
  messages: [{ role: "user", content: "Hello." }],
  stream: true,
});
for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
}`,
    curl: `curl ${base}/chat/completions \\
  -H "Authorization: Bearer uai_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "unabridged",
    "stream": true,
    "messages": [{"role": "user", "content": "Hello."}]
  }'`,
    tools: `completion = client.chat.completions.create(
    model="unabridged",
    messages=[{"role": "user", "content": "What's the weather in Lisbon?"}],
    tools=[{
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Get current weather",
            "parameters": {
                "type": "object",
                "properties": {"city": {"type": "string"}},
                "required": ["city"],
            },
        },
    }],
)`,
  }), [base]);

  const grab = async (id: string, value: string) => {
    await copy(value);
    setCopied(id);
    window.setTimeout(() => setCopied(""), 1500);
  };

  return (
    <section className="docs">
      <div className="docs-intro">
        <p>UnabridgedAI speaks the OpenAI Chat Completions protocol. Point any compatible client at <code>{base}</code> and authenticate with a <code>uai_</code> key from Get API.</p>
      </div>

      <article>
        <div className="eyebrow">connection</div>
        <h2>Base URL and auth</h2>
        <div className="ledger-line"><span>base URL</span><strong>{base}</strong></div>
        <div className="ledger-line"><span>auth</span><strong>Authorization: Bearer uai_…</strong></div>
        <div className="ledger-line"><span>models</span><strong>GET /v1/models</strong></div>
        <div className="ledger-line"><span>chat</span><strong>POST /v1/chat/completions</strong></div>
        <p>The UnabridgedAI system prompt is always prepended. Extra <code>system</code> messages from the client are additional instructions, not a replacement.</p>
        <button className="secondary" onClick={() => grab("url", base)}>{copied === "url" ? "copied" : "copy base URL"}</button>
      </article>

      <article>
        <div className="eyebrow">open webui</div>
        <h2>Connect a provider</h2>
        <ol className="docs-steps">
          <li>Open Open WebUI → Admin → Settings → Connections.</li>
          <li>Add an OpenAI connection.</li>
          <li>API URL: <code>{base}</code></li>
          <li>API key: a <code>uai_</code> key from Get API.</li>
          <li>Save. Whitelist model ID <code>unabridged</code> if the selector is empty.</li>
        </ol>
      </article>

      <article>
        <div className="eyebrow">python</div>
        <h2>openai SDK</h2>
        <p><code>pip install openai</code></p>
        <pre className="snippet">{samples.python}</pre>
        <button className="secondary" onClick={() => grab("python", samples.python)}>{copied === "python" ? "copied" : "copy"}</button>
      </article>

      <article>
        <div className="eyebrow">streaming</div>
        <h2>SSE chunks</h2>
        <p>Set <code>stream: true</code>. The response is standard OpenAI <code>text/event-stream</code>.</p>
        <pre className="snippet">{samples.stream}</pre>
        <button className="secondary" onClick={() => grab("stream", samples.stream)}>{copied === "stream" ? "copied" : "copy"}</button>
      </article>

      <article>
        <div className="eyebrow">node</div>
        <h2>openai package</h2>
        <p><code>npm install openai</code></p>
        <pre className="snippet">{samples.node}</pre>
        <button className="secondary" onClick={() => grab("node", samples.node)}>{copied === "node" ? "copied" : "copy"}</button>
      </article>

      <article>
        <div className="eyebrow">curl</div>
        <h2>raw HTTP</h2>
        <pre className="snippet">{samples.curl}</pre>
        <button className="secondary" onClick={() => grab("curl", samples.curl)}>{copied === "curl" ? "copied" : "copy"}</button>
      </article>

      <article>
        <div className="eyebrow">tools</div>
        <h2>function calling</h2>
        <p><code>tools</code>, <code>tool_choice</code>, and tool-call deltas pass through to the model. Return tool results as <code>role: "tool"</code> messages in the next request.</p>
        <pre className="snippet">{samples.tools}</pre>
        <button className="secondary" onClick={() => grab("tools", samples.tools)}>{copied === "tools" ? "copied" : "copy"}</button>
      </article>
    </section>
  );
}
