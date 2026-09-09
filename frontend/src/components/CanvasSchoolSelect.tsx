import { useState } from 'react';
import { GraduationCap } from 'lucide-react';
import type { CanvasSchool } from '../api/canvasToDoApi';
import { appPath } from '../lib/appPath';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

// Bundled from each institution's public Canvas branding. No token or third-party
// request is needed to display the school picker. Provenance lives with the assets.
const schoolBranding: Record<string, { asset: string; background: string }> = {
  'https://sfu.instructure.com': { asset: 'sfu.png', background: '#54585a' },
  'https://canvas.ubc.ca': { asset: 'ubc.png', background: '#002145' },
  'https://canvas.usask.ca': { asset: 'usask.png', background: '#ffffff' },
  'https://canvas.uw.edu': { asset: 'uw.png', background: '#4b2e83' },
  'https://canvas.stanford.edu': { asset: 'stanford.png', background: '#8c1515' },
  'https://canvas.harvard.edu': { asset: 'harvard.svg', background: '#293352' },
};

function SchoolOption({ name, instanceUrl = '' }: { name: string; instanceUrl?: string }) {
  const brand = schoolBranding[instanceUrl.replace(/\/+$/, '').toLowerCase()];
  const [failedAsset, setFailedAsset] = useState('');
  const showLogo = brand && failedAsset !== brand.asset;
  return <span className="flex min-w-0 items-center gap-3">
    <span aria-hidden="true" className="flex h-10 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted p-1"
      style={showLogo ? { backgroundColor: brand.background } : undefined}>
      {showLogo ? <img alt="" className="h-full w-full object-contain" src={appPath(`/brand/schools/${brand.asset}`)}
        onError={() => setFailedAsset(brand.asset)} /> : <GraduationCap className="size-5 text-muted-foreground" />}
    </span>
    <span className="min-w-0 whitespace-normal text-left leading-5">{name}</span>
  </span>;
}

export function CanvasSchoolSelect({ id, schools, value, onValueChange, disabled, placeholder, otherLabel }: {
  id: string;
  schools: CanvasSchool[];
  value: string;
  onValueChange: (value: string) => void;
  disabled: boolean;
  placeholder: string;
  otherLabel: string;
}) {
  const selectedSchool = schools.find(school => school.instanceUrl === value);
  return <Select value={value} onValueChange={onValueChange} disabled={disabled}>
    <SelectTrigger id={id} className="h-auto min-h-14 w-full min-w-0 bg-background py-1.5 *:data-[slot=select-value]:min-w-0 *:data-[slot=select-value]:line-clamp-none">
      <SelectValue placeholder={placeholder}>
        {selectedSchool ? <SchoolOption {...selectedSchool} /> : value === 'custom' ? <SchoolOption name={otherLabel} /> : undefined}
      </SelectValue>
    </SelectTrigger>
    <SelectContent position="popper" align="start" className="max-w-[calc(100vw-2rem)]">
      {schools.map(school => <SelectItem key={school.instanceUrl} value={school.instanceUrl} textValue={school.name} className="py-2">
        <SchoolOption {...school} />
      </SelectItem>)}
      <SelectItem value="custom" textValue={otherLabel} className="py-2"><SchoolOption name={otherLabel} /></SelectItem>
    </SelectContent>
  </Select>;
}
