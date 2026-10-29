import { ChangeEvent } from 'react';
import { useOrgStore } from '../../stores/useOrgStore';

export function OrgSelector() {
  const orgs = useOrgStore((s) => s.orgs);
  const currentOrgId = useOrgStore((s) => s.currentOrgId);
  const orgsStatus = useOrgStore((s) => s.orgsStatus);
  const selectOrg = useOrgStore((s) => s.selectOrg);

  if (orgsStatus === 'loading' || orgsStatus === 'idle') {
    return <span className="text-sm opacity-60">Loading orgs…</span>;
  }
  if (orgsStatus === 'error') {
    return <span className="text-sm text-red-400">Failed to load orgs</span>;
  }
  if (orgs.length === 0) {
    return <span className="text-sm opacity-60">No organisation</span>;
  }

  const onChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value;
    void selectOrg(next);
  };

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="opacity-60">Orga</span>
      <select
        className="rounded bg-neutral-800 px-2 py-1 text-sm"
        value={currentOrgId ?? ''}
        onChange={onChange}
      >
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}
