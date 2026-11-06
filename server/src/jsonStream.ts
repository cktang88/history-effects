// Incremental scanner over a streamed JSON document. Emits each object as soon
// as it closes, if it sits directly under a top-level key (`{"event": {...}}`)
// or inside a top-level array (`{"effects": [{...}, {...}]}`). This lets the
// UI show items one by one while the model is still writing the rest.

type Frame = { type: "{" | "["; key: string | null; start: number };

export type JsonObjectHandler = (key: string, value: unknown) => void;

export function createJsonObjectStream(onObject: JsonObjectHandler) {
  let buf = "";
  let i = 0;
  let inString = false;
  let escape = false;
  let stringStart = -1;
  let lastString: string | null = null;
  let pendingKey: string | null = null;
  const stack: Frame[] = [];

  const top = () => stack[stack.length - 1];

  const closeObject = (frame: Frame, end: number) => {
    const parent = top();
    const isTopLevelValue = stack.length === 1 && parent?.type === "{";
    const isTopLevelArrayItem = stack.length === 2 && parent?.type === "[";
    if (!frame.key || !(isTopLevelValue || isTopLevelArrayItem)) return;
    try {
      onObject(frame.key, JSON.parse(buf.slice(frame.start, end + 1)));
    } catch {
      // Malformed fragment; the final whole-document parse will handle it.
    }
  };

  const step = (ch: string) => {
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') {
        inString = false;
        try {
          lastString = JSON.parse(buf.slice(stringStart, i + 1)) as string;
        } catch {
          lastString = null;
        }
      }
      return;
    }
    switch (ch) {
      case '"':
        inString = true;
        stringStart = i;
        return;
      case ":":
        if (top()?.type === "{") pendingKey = lastString;
        return;
      case ",":
        pendingKey = null;
        return;
      case "{":
      case "[": {
        const parent = top();
        const key = parent?.type === "[" ? parent.key : pendingKey;
        stack.push({ type: ch, key, start: i });
        pendingKey = null;
        return;
      }
      case "}":
      case "]": {
        const frame = stack.pop();
        if (frame?.type === "{") closeObject(frame, i);
        return;
      }
    }
  };

  return {
    feed(chunk: string) {
      buf += chunk;
      for (; i < buf.length; i++) step(buf[i]!);
    },
  };
}
