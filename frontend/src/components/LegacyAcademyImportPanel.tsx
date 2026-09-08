import { ArchiveRestore, ChevronDown, Loader2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { canvasToDoApi } from '../api/canvasToDoApi';
import { useLanguage } from '../context/LanguageContext';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';

interface LegacyAcademyImportPanelProps {
  onImported?: () => Promise<void> | void;
}

const copy = {
  en: {
    description: 'If you signed in to the retired Academy site with an Academy ID, copy its saved Canvas connection and calendar preferences into this account.',
    error: 'Unable to import legacy Academy data.',
    id: 'Legacy Academy ID',
    import: 'Import legacy data',
    importing: 'Verifying and importing…',
    note: 'An old account can be linked only once. Existing Canvas To Do settings are never overwritten, and the old data remains unchanged. Email addresses, profile details, and roles are not imported.',
    password: 'Legacy Academy password',
    title: 'Import legacy Academy data',
  },
  ko: {
    description: '이전 Academy 사이트에서 Academy ID로 로그인했다면 저장된 Canvas 연결 및 캘린더 환경설정을 이 계정으로 복사할 수 있습니다.',
    error: '이전 Academy 데이터를 가져올 수 없습니다.',
    id: '이전 Academy ID',
    import: '이전 데이터 가져오기',
    importing: '확인 후 가져오는 중…',
    note: '이전 계정은 한 번만 연결할 수 있습니다. 현재 Canvas To Do 설정은 덮어쓰지 않으며 이전 데이터도 변경하지 않습니다. 이메일 주소, 프로필 정보 및 역할은 가져오지 않습니다.',
    password: '이전 Academy 비밀번호',
    title: '이전 Academy 데이터 가져오기',
  },
} as const;

export function LegacyAcademyImportPanel({ onImported }: LegacyAcademyImportPanelProps) {
  const { language } = useLanguage();
  const labels = language === 'ko' ? copy.ko : copy.en;
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsBusy(true);
    setError('');
    setMessage('');

    try {
      const importRequest = canvasToDoApi.importLegacyAcademyData({
        loginId: loginId.trim(),
        password,
      });

      // The API has already serialized the request body. Drop the password from
      // component state while the network request is still in flight.
      setPassword('');

      const result = await importRequest;
      setLoginId('');
      setMessage(result.message);

      try {
        await onImported?.();
      } catch {
        // The claim and copy already committed. Keep the accurate success message;
        // the regular settings refresh will pick the imported values up later.
      }
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : labels.error);
    } finally {
      setPassword('');
      setIsBusy(false);
    }
  };

  return (
    <details className="group rounded-lg border bg-muted/20 p-3">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-black text-foreground">
        <span className="flex min-w-0 items-center gap-2">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg border bg-card text-primary">
            <ArchiveRestore aria-hidden="true" className="size-4" />
          </span>
          <span className="truncate">{labels.title}</span>
        </span>
        <ChevronDown aria-hidden="true" className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <form
        autoComplete="off"
        className="mt-3 grid gap-4 rounded-lg border bg-card p-3"
        onSubmit={handleSubmit}
      >
        <div className="grid gap-1.5">
          <p className="text-sm font-semibold leading-6 text-foreground">{labels.description}</p>
          <p className="text-xs font-semibold leading-5 text-muted-foreground">{labels.note}</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="grid gap-1.5">
            <Label className="text-xs font-black uppercase text-muted-foreground" htmlFor="legacy-academy-id">
              {labels.id}
            </Label>
            <Input
              autoCapitalize="none"
              autoComplete="off"
              disabled={isBusy}
              id="legacy-academy-id"
              maxLength={64}
              minLength={3}
              onChange={(event) => setLoginId(event.target.value)}
              required
              spellCheck={false}
              value={loginId}
            />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs font-black uppercase text-muted-foreground" htmlFor="legacy-academy-password">
              {labels.password}
            </Label>
            <Input
              autoComplete="off"
              disabled={isBusy}
              id="legacy-academy-password"
              maxLength={256}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </div>
        </div>
        {error ? (
          <div
            aria-live="assertive"
            className="rounded-md border border-red-500/35 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-700 dark:text-red-200"
            role="alert"
          >
            {error}
          </div>
        ) : null}
        {message ? (
          <div
            aria-live="polite"
            className="rounded-md border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-700 dark:text-emerald-200"
            role="status"
          >
            {message}
          </div>
        ) : null}
        <div className="flex justify-end">
          <Button
            className="rounded-md"
            disabled={isBusy || loginId.trim().length < 3 || !password}
            type="submit"
          >
            {isBusy ? (
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <ArchiveRestore aria-hidden="true" className="size-4" />
            )}
            {isBusy ? labels.importing : labels.import}
          </Button>
        </div>
      </form>
    </details>
  );
}
