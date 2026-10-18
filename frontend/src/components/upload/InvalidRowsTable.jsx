// Shows the rows that failed validation, one page at a time (the list can be huge).
import { useEffect, useState } from 'react';
import { Alert, Spinner, Table } from 'react-bootstrap';
import { excelService } from '../../services/excelService.js';
import { getErrorMessage } from '../../services/api.js';
import PaginationBar from '../common/PaginationBar.jsx';
import { formatNumber } from '../../utils/format.js';

const PAGE_SIZE = 10;

export default function InvalidRowsTable({ uploadId, total }) {
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    excelService
      .getErrors(uploadId, page, PAGE_SIZE)
      .then((result) => !cancelled && setRows(result.data))
      .catch((err) => !cancelled && setError(getErrorMessage(err)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [uploadId, page, total]);

  if (error) return <Alert variant="danger">{error}</Alert>;

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const empty = <em className="text-muted">(empty)</em>;

  return (
    <>
      <div className="table-responsive position-relative border rounded">
        <Table className="mb-0 align-top invalid-rows-table">
          <thead>
            <tr>
              <th style={{ width: 90 }}>Row No.</th>
              <th>Name</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Error Message</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.rowNumber}>
                <td>{formatNumber(row.rowNumber)}</td>
                <td className="text-break">{row.values.name || empty}</td>
                <td className="text-break">{row.values.email || empty}</td>
                <td className="text-break">{row.values.phone || empty}</td>
                <td className="error-text">
                  {row.messages.map((message) => (
                    <div key={message}>{message}</div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        {loading && (
          <div className="table-loading">
            <Spinner animation="border" size="sm" />
          </div>
        )}
      </div>
      {totalPages > 1 && (
        <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mt-2">
          <span className="text-muted small">
            Page {formatNumber(page)} of {formatNumber(totalPages)}
          </span>
          <PaginationBar page={page} totalPages={totalPages} disabled={loading} onChange={setPage} />
        </div>
      )}
    </>
  );
}
