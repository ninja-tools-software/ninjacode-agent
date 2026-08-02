import React, { isValidElement, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { MermaidBlock } from "./MermaidBlock.js";

function isMermaidCode(child: ReactNode): child is React.ReactElement<{ className?: string; children?: ReactNode }> {
  return (
    isValidElement(child) &&
    typeof child.props === "object" &&
    child.props !== null &&
    "className" in child.props &&
    typeof child.props.className === "string" &&
    /language-mermaid/.test(child.props.className)
  );
}

export function ChatMarkdown({
  children,
  deferMermaid = false,
  onMermaidOpen,
}: {
  children: string;
  deferMermaid?: boolean;
  onMermaidOpen?: (source: string) => void;
}) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={{
        pre({ children }) {
          if (isMermaidCode(children)) {
            return <>{children}</>;
          }
          return <pre>{children}</pre>;
        },
        code({ className, children, ...props }) {
          if (/language-mermaid/.test(className ?? "")) {
            const source = String(children).replace(/\n$/, "");
            return (
              <MermaidBlock
                source={source}
                deferRender={deferMermaid}
                onOpen={onMermaidOpen ? () => onMermaidOpen(source) : undefined}
              />
            );
          }
          const inline = !className;
          if (inline) {
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          }
          return (
            <code className={className} {...props}>
              {children}
            </code>
          );
        },
      }}
    >
      {children}
    </Markdown>
  );
}
