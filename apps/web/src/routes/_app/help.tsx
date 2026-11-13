import { Link, createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '../../components/ui';

export const Route = createFileRoute('/_app/help')({ component: Help });

const Q = ({ q, children }: { q: string; children: React.ReactNode }) => (
  <details className="card" style={{ marginBottom: 10 }}>
    <summary style={{ cursor: 'pointer', padding: '12px 16px', fontWeight: 500, fontSize: 14 }}>{q}</summary>
    <div className="card-body" style={{ paddingTop: 0, fontSize: 13.5, lineHeight: 1.65, color: 'var(--text-secondary)' }}>{children}</div>
  </details>
);
const H = ({ children }: { children: React.ReactNode }) => <h2 style={{ fontSize: 15, fontWeight: 600, margin: '24px 0 10px' }}>{children}</h2>;

function Help() {
  return (
    <div className="page-wrapper">
      <PageHeader pretitle="Account" title="Help" />
      <div style={{ maxWidth: 780 }}>
        <H>Reading</H>
        <Q q="How do I read a book?">Open it from the <Link to="/catalog">Catalog</Link> and press <strong>Read now</strong>. EPUBs have a chapter menu and text-size buttons; PDFs open in a full viewer. Both follow your light or dark theme. Use <kbd className="kbd">←</kbd> <kbd className="kbd">→</kbd> to turn pages in an EPUB.</Q>
        <Q q="Where does my progress go?">Your place in each book is saved automatically and you resume where you stopped — on any device you sign in from. Time spent reading is recorded (only while the tab is visible and you’ve been active recently) and feeds the <Link to="/log">Reading log</Link> and <Link to="/analytics">analytics</Link>.</Q>
        <Q q="What are the reading log’s notes and tasks?">Pick any day in the calendar and jot down notes (“loved this scene”) or tasks (“finish chapter 5”). Tasks can be ticked off. They’re private to you.</Q>
        <Q q="Can I take my data with me?">Yes. <Link to="/settings">Settings → Your data</Link> downloads your progress, sessions and notes as a JSON file.</Q>

        <H>Adding and editing books (administrators)</H>
        <Q q="How do I add books?">Go to <Link to="/upload">Add books</Link>. Drag in EPUB or PDF files — or whole folders; the folder structure is kept. Title, author, chapters and cover are read from the files; check them, then press Upload. Each file can be up to 100 MB.</Q>
        <Q q="How do I add a book by ISBN?">On <Link to="/upload" search={{ tab: 'scan' }}>Add books → Scan ISBN</Link>, scan the barcode with your camera (Chrome, Edge and Android) or type the number. The details are filled in from Open Library; you can attach the file now or later.</Q>
        <Q q="How do I edit a PDF’s title, author or chapters?">Open the book and press <strong>Edit details &amp; chapters</strong>. For PDFs the changes are written <strong>into the PDF file itself</strong>, so they travel with it. A PDF with no chapters can be given some — add them one by one or paste a contents list. If someone else changed the file in the meantime, you’ll be asked to reload instead of overwriting their work.</Q>
        <Q q="Why can’t I edit an EPUB’s details inside the file?">EPUB details are kept in the library catalog only. Only PDFs are rewritten.</Q>
        <Q q="A PDF won’t open for editing.">Password-protected PDFs can’t be edited. If a file is damaged, re-export it and upload it again.</Q>

        <H>Requests</H>
        <Q q="How do I ask for a book the library doesn’t have?">Add it on the <Link to="/acquisitions">Acquisitions</Link> board. Administrators move requests through Evaluating, Ordered and Received. You can edit or withdraw your own request until an administrator moves it.</Q>

        <H>Accounts (administrators)</H>
        <Q q="How do I add or remove a member?">Open <Link to="/members">Members</Link>. Add a member with a password (use <em>Generate</em>) and give it to them — they can change it under <Link to="/profile">Your profile</Link>. Changing a role or removing a member takes effect immediately, and resetting a password signs them out everywhere.</Q>
        <Q q="I’m locked out.">Another administrator can reset your password. If you’re the only one, run <code>pnpm bootstrap-admin</code> with your email to set a new password (add <code>--remote</code> for the live site).</Q>

        <H>Shortcuts</H>
        <Q q="Which keyboard shortcuts are there?"><kbd className="kbd">?</kbd> list · <kbd className="kbd">/</kbd> search · <kbd className="kbd">T</kbd> theme · <kbd className="kbd">G</kbd> then <kbd className="kbd">O</kbd> overview, <kbd className="kbd">C</kbd> catalog, <kbd className="kbd">L</kbd> log, <kbd className="kbd">A</kbd> analytics, <kbd className="kbd">B</kbd> books, <kbd className="kbd">U</kbd> add books, <kbd className="kbd">F</kbd> files.</Q>
      </div>
    </div>
  );
}
