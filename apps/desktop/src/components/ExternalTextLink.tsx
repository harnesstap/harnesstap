import { httpUrlOrNull, openExternalUrl } from "../lib/external-url";

export interface ExternalTextLinkProps {
  href: string;
}

export function ExternalTextLink({ href }: ExternalTextLinkProps) {
  const url = httpUrlOrNull(href);
  if (!url) {
    return href;
  }
  return (
    <a
      className="link-btn"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => {
        event.preventDefault();
        void openExternalUrl(url);
      }}
    >
      {url}
    </a>
  );
}
