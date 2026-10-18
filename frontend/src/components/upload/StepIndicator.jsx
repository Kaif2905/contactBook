// The "1 Choose file - 2 Match columns - 3 Review - 4 Import" bar at the top of the upload page.
export const UPLOAD_STEPS = ['Choose file', 'Match columns', 'Review rows', 'Import'];

export default function StepIndicator({ current }) {
  return (
    <ol className="upload-steps list-unstyled d-flex flex-wrap gap-3 mb-4">
      {UPLOAD_STEPS.map((label, index) => {
        const state = index < current ? 'done' : index === current ? 'active' : 'todo';
        return (
          <li key={label} className={`upload-step upload-step-${state}`}>
            <span className="upload-step-number">{state === 'done' ? <i className="bi bi-check-lg" /> : index + 1}</span>
            <span className="upload-step-label">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
