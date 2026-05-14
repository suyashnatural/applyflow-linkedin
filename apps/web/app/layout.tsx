import type { ReactNode } from "react";

export const metadata = {
  title: "ApplyFlow Review",
  description: "Human-in-the-loop review for LinkedIn Easy Apply automation.",
};

export default function RootLayout(props: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif" }}>
        {props.children}
      </body>
    </html>
  );
}
