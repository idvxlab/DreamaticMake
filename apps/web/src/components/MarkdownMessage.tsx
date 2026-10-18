import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
export function MarkdownMessage({
  text,
  card = false,
  inline = false,
  links = true,
}: {
  text: string;
  card?: boolean;
  inline?: boolean;
  links?: boolean;
}) {
  const Container = inline ? "span" : "div";
  return (
    <Container
      className={`${card ? "card-markdown" : "message-content"} markdown-content${inline ? " markdown-inline" : ""}`}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          ...(inline
            ? { p: ({ children }: any) => <span>{children}</span> }
            : {}),
          a: ({ children, href }) =>
            links ? (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
          img: ({ alt }) => (
            <span className="markdown-image-label">
              [图片：{alt || "未命名"}]
            </span>
          ),
          table: ({ children }) => (
            <div className="markdown-table">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </Container>
  );
}
