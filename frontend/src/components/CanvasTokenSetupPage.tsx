import { useState, type FormEvent } from 'react';
import { ExternalLink, ClipboardPaste, KeyRound } from 'lucide-react';
import { canvasToDoApi, type CanvasTokenStatus } from '../api/canvasToDoApi';
import { useLanguage } from '../context/LanguageContext';
import { appPath } from '../lib/appPath';
import { canvasSettingsUrl } from '../lib/canvasOnboarding';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { DateTimeField } from './DateTimeField';

export function CanvasTokenSetupPage({ status, onConnected, onContinue }: {
  status: CanvasTokenStatus | null;
  onConnected: (status: CanvasTokenStatus) => void;
  onContinue: () => void;
}) {
  const { language, dictionary } = useLanguage();
  const ko = language === 'ko';
  const [instanceUrl, setInstanceUrl] = useState(status?.instanceUrl ?? '');
  const [accessToken, setAccessToken] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [clipboardMessage, setClipboardMessage] = useState('');
  const settingsUrl = canvasSettingsUrl(instanceUrl);
  const manualEnabled = status?.manualTokenEnabled !== false;
  const steps = [
    { image: 'settings', title: ko ? '학교 Canvas에서 설정 열기' : 'Open your school’s Canvas settings', text: ko ? '아래에 학교 Canvas 주소를 입력하고 설정 열기를 누르세요. Canvas에서 Account → Settings로 이동할 수도 있습니다.' : 'Enter your school’s Canvas address below and open settings. You can also choose Account → Settings in Canvas.' },
    { image: 'add-token', title: ko ? '새 토큰 만들기' : 'Add a token', text: ko ? 'Approved Integrations에서 New Access Token을 선택하세요. 버튼이 없다면 학교 관리자에게 문의하거나 Canvas 로그인을 사용하세요.' : 'Under Approved Integrations, choose New Access Token. If unavailable, ask your school or use Canvas sign-in.' },
    { image: 'token-details', title: ko ? '발급 후 여기 붙여넣기' : 'Generate, copy, and paste here', text: ko ? 'Purpose에 Canvas To Do를 입력하고 만료일을 정한 뒤 Generate Token을 누르세요. 토큰을 복사해 아래에 붙여넣고 같은 만료일을 입력하세요.' : 'Use Canvas To Do as the purpose, choose an expiry, then generate the token. Copy it into the field below and enter the same expiry.' },
  ];
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!settingsUrl || !accessToken.trim()) return;
    setIsSaving(true); setError('');
    try {
      const nextStatus = await canvasToDoApi.updateCanvasToken({
        instanceUrl: new URL(settingsUrl).origin, accessToken: accessToken.trim(),
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
      });
      setAccessToken('');
      onConnected(nextStatus);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : dictionary.canvasTokenSaveFailed);
    } finally { setIsSaving(false); }
  };
  return (
    <div className="grid gap-5">
      <p id="canvas-token-setup-description" className="text-sm text-muted-foreground">
        {ko ? 'Canvas를 연결해 과목과 할 일을 가져오세요. 나중에 계속할 수 있으며, 설정에서 Canvas 토큰 연결 알림을 끌 수 있습니다.' : 'Connect Canvas to bring in your courses and tasks. Continue for now, or turn off Canvas token reminders in Settings if you prefer manual courses.'}
      </p>
      {status?.status === 'expired' || status?.status === 'invalid' ? <p role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">{ko ? '저장된 토큰을 갱신해 Canvas를 다시 연결하세요.' : 'Your saved token needs to be replaced to reconnect Canvas.'}</p> : null}
      {status?.oauthConfigured && status.connectUrl ? (
        <Button className="justify-self-start" onClick={() => {
          const url = new URL(status.connectUrl!, window.location.origin);
          url.searchParams.set('returnUrl', `${appPath('/')}?canvasReturn=settings`);
          window.location.assign(url.href);
        }}><ExternalLink className="size-4" />{dictionary.canvasOauthConnect}</Button>
      ) : null}
      {manualEnabled ? <>
        <div className="order-3 grid gap-4 md:order-none md:grid-cols-3">
          {steps.map((step, index) => <figure className="min-w-0 rounded-xl border bg-muted/20 p-3" key={step.image}>
            <figcaption>
              <h3 className="text-sm font-bold">{index + 1}. {step.title}</h3>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">{step.text}</p>
            </figcaption>
            <a href={appPath(`/guide/canvas/${step.image}.png`)} target="_blank" rel="noreferrer" aria-label={`${step.title} — ${ko ? '이미지 확대' : 'enlarge screenshot'}`}>
              <img className="mt-3 h-48 w-full rounded border bg-white object-contain" src={appPath(`/guide/canvas/${step.image}.png`)} alt={step.title} loading="lazy" />
            </a>
          </figure>)}
        </div>
        <p className="order-4 text-xs text-muted-foreground md:order-none">
          {ko ? 'Canvas 공식 안내의 화면입니다. 학교에 따라 다를 수 있습니다.' : 'Screenshots from the Canvas guide; your school’s screens may differ.'}{' '}
          <a className="underline" href="https://community.instructure.com/en/kb/articles/662901-how-do-i-manage-api-access-tokens-in-my-user-account" target="_blank" rel="noreferrer">{ko ? '원본 안내' : 'Original guide'}</a>
        </p>
        <form onSubmit={submit} className="order-2 grid gap-4 rounded-xl border bg-muted/20 p-4 md:order-none">
          <h3 className="flex items-center gap-2 font-bold"><KeyRound className="size-4" />{ko ? '토큰 붙여넣고 연결' : 'Paste your token and connect'}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-2 text-sm font-semibold">{dictionary.canvasTokenInstanceUrl}
              <Input autoComplete="url" type="url" placeholder="https://your-school.instructure.com" value={instanceUrl} onChange={(event) => setInstanceUrl(event.target.value)} required disabled={isSaving} />
            </label>
            <div className="flex items-end"><Button asChild variant="outline" disabled={!settingsUrl}>
              <a href={settingsUrl ?? undefined} aria-disabled={!settingsUrl} target="_blank" rel="noreferrer" onClick={(event) => { if (!settingsUrl) event.preventDefault(); }}><ExternalLink className="size-4" />{ko ? 'Canvas 설정 열기' : 'Open Canvas settings'}</a>
            </Button></div>
            <label className="grid gap-2 text-sm font-semibold">{dictionary.canvasTokenValue}
              <Input autoComplete="new-password" autoCapitalize="none" spellCheck={false} type="password" value={accessToken} onChange={(event) => setAccessToken(event.target.value)} required disabled={isSaving} placeholder={dictionary.canvasTokenValuePlaceholder} />
            </label>
            <div className="flex items-end"><Button variant="outline" type="button" disabled={isSaving} onClick={async () => {
              try { setAccessToken((await navigator.clipboard.readText()).trim()); setClipboardMessage(''); }
              catch { setClipboardMessage(ko ? '토큰 입력란에 Ctrl+V / ⌘V로 붙여넣으세요.' : 'Paste into the token field with Ctrl+V / ⌘V, or your device’s Paste menu.'); }
            }}><ClipboardPaste className="size-4" />{ko ? '토큰 붙여넣기' : 'Paste token'}</Button></div>
            <div className="grid gap-2 text-sm font-semibold"><label htmlFor="canvas-setup-expiry">{dictionary.canvasTokenExpiresAt}</label>
              <DateTimeField id="canvas-setup-expiry" value={expiresAt} onChange={setExpiresAt} defaultTime="23:59" disabled={isSaving} />
              <p className="text-xs font-normal text-muted-foreground">{ko ? 'Canvas에 표시된 만료일과 시간을 입력하세요.' : 'Match the expiry shown in Canvas. Leave blank only if your token has no expiry.'}</p>
            </div>
          </div>
          {clipboardMessage ? <p role="status" className="text-sm">{clipboardMessage}</p> : null}
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <Button className="justify-self-end" type="submit" disabled={isSaving || !settingsUrl || !accessToken.trim()}>{isSaving ? dictionary.canvasTokenSaving : dictionary.canvasTokenSave}</Button>
        </form>
      </> : <p className="text-sm text-muted-foreground">{dictionary.canvasManualTokenDisabled}</p>}
      <div className="order-5 flex justify-end md:order-none"><Button type="button" variant="outline" onClick={onContinue} disabled={isSaving}>{ko ? '나중에 연결하기' : 'Continue for now'}</Button></div>
    </div>
  );
}
