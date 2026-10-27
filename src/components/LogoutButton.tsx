/** "Log out" as a POST form (never a link: links get prefetched and can be triggered cross-site). */
export function LogoutButton({ className = 'btn btn--small' }: { className?: string }) {
  return (
    <form method="post" action="/logout" className="inline-form">
      <button type="submit" className={className}>
        Log out
      </button>
    </form>
  );
}
