import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="card">
      <h1>Not found</h1>
      <p>That page or order does not exist.</p>
      <p>
        <Link href="/" className="action-link">
          Back to orders
        </Link>
      </p>
    </div>
  );
}
