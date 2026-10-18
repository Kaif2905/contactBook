// Page buttons:  « ‹ 1 … 4 [5] 6 … 20 › »
import { Pagination } from 'react-bootstrap';

/** Which page numbers to show around the current page. null = "…" */
function pageNumbers(page, totalPages) {
  const pages = new Set([1, totalPages, page - 1, page, page + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);

  const withGaps = [];
  sorted.forEach((p, index) => {
    if (index > 0 && p - sorted[index - 1] > 1) withGaps.push(null);
    withGaps.push(p);
  });
  return withGaps;
}

export default function PaginationBar({ page, totalPages, onChange, disabled = false }) {
  if (totalPages <= 1) return null;

  return (
    <Pagination className="mb-0" size="sm">
      <Pagination.First disabled={disabled || page === 1} onClick={() => onChange(1)} aria-label="First page" />
      <Pagination.Prev disabled={disabled || page === 1} onClick={() => onChange(page - 1)} aria-label="Previous page" />
      {pageNumbers(page, totalPages).map((number, index) =>
        number === null ? (
          <Pagination.Ellipsis key={`gap-${index}`} disabled />
        ) : (
          <Pagination.Item key={number} active={number === page} disabled={disabled} onClick={() => onChange(number)}>
            {number}
          </Pagination.Item>
        ),
      )}
      <Pagination.Next disabled={disabled || page === totalPages} onClick={() => onChange(page + 1)} aria-label="Next page" />
      <Pagination.Last disabled={disabled || page === totalPages} onClick={() => onChange(totalPages)} aria-label="Last page" />
    </Pagination>
  );
}
