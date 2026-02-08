import "./globals.css";

export const metadata = {
  title: "Clawd US",
  description: "Online social-deduction game MVP"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="bg">
          <header className="topbar">
            <div className="brand">Clawd US</div>
            <div className="tag">Online Social Deduction • MVP</div>
          </header>
          <main className="main">{children}</main>
          <footer className="footer">No email. No verification. Username + password.</footer>
        </div>
      </body>
    </html>
  );
}
