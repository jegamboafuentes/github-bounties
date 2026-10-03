/** Friendly validation line for a search box. Empty when the query is fine. */
export function SearchValidationNotice({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="text-sm text-red-700 dark:text-red-300" role="alert">
      {message}
    </p>
  );
}
