import { useState, type FormEvent } from 'react';
import { ExternalLink, ClipboardPaste, KeyRound, ChevronLeft, ChevronRight, ChevronDown, ZoomIn } from 'lucide-react';
import { canvasToDoApi, type CanvasTokenStatus } from '../api/canvasToDoApi';
import { useLanguage } from '../context/LanguageContext';
import { appPath } from '../lib/appPath';
import { canvasSettingsUrl } from '../lib/canvasOnboarding';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { DateTimeField } from './DateTimeField';
import { CanvasSchoolSelect } from './CanvasSchoolSelect';

export function CanvasTokenSetupPage({ status, onConnected, onContinue }: {
  status: CanvasTokenStatus | null;
  onConnected: (status: CanvasTokenStatus) => void;
  onContinue: () => void;
}) {
  const { language, dictionary } = useLanguage();
  const ko = language === 'ko';
  const schools = status?.schools ?? [];
  const [instanceUrl, setInstanceUrl] = useState(status?.configured ? status.instanceUrl ?? '' : '');
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [accessToken, setAccessToken] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [clipboardMessage, setClipboardMessage] = useState('');
  const settingsUrl = canvasSettingsUrl(instanceUrl);
  const selectedSchool = schools.find((school) => canvasSettingsUrl(school.instanceUrl) === settingsUrl);
  const changeInstanceUrl = (value: string) => {
    setInstanceUrl(value);
    setAccessToken('');
    setExpiresAt('');
    setError('');
    setClipboardMessage('');
  };
  const manualEnabled = status?.manualTokenEnabled !== false;
  const steps = [
    { image: 'settings', title: ko ? '학교 Canvas에서 설정 열기' : 'Open your school’s Canvas settings', text: ko ? '학교를 선택하고 Canvas 설정 열기를 누르세요. Canvas에서 Account → Settings로 이동할 수도 있습니다.' : 'Select your school and choose Open Canvas settings. You can also choose Account → Settings in Canvas.' },
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
      {manualEnabled ? <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(340px,1fr)]">
        <section className="order-2 grid min-w-0 gap-4 rounded-xl border bg-muted/20 p-4 lg:order-1" aria-label={ko ? '토큰 발급 안내' : 'Token setup walkthrough'}>
          <h3 className="text-lg font-bold">{ko ? '토큰 발급 방법' : 'How to generate your token'}</h3>
          <div className="grid gap-2 sm:grid-cols-3" aria-label={ko ? '안내 단계' : 'Guide steps'}>
            {steps.map((step, index) => <Button key={step.image} type="button" variant={stepIndex === index ? 'default' : 'outline'}
              className="h-auto whitespace-normal py-3 text-left" aria-current={stepIndex === index ? 'step' : undefined}
              onClick={() => setStepIndex(index)}>{index + 1}. {step.title}</Button>)}
          </div>
          <figure className="min-w-0" aria-live="polite">
            <figcaption className="mb-4">
              <h3 className="text-lg font-bold">{stepIndex + 1}. {steps[stepIndex].title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{steps[stepIndex].text}</p>
            </figcaption>
            <a className="block rounded-lg border bg-white p-2" href={appPath(`/guide/canvas/${steps[stepIndex].image}.png`)} target="_blank" rel="noreferrer"
              aria-label={ko ? '안내 이미지 원본 크기로 열기' : 'Open screenshot at full size'}>
              <img className="mx-auto h-auto w-full max-w-[1000px] object-contain" style={{ maxWidth: stepIndex === 0 ? 560 : 1000 }}
                src={appPath(`/guide/canvas/${steps[stepIndex].image}.png`)} alt={steps[stepIndex].title} />
            </a>
          </figure>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button type="button" variant="outline" onClick={() => setStepIndex(index => index - 1)} disabled={stepIndex === 0}>
              <ChevronLeft className="size-4" />{ko ? '이전' : 'Previous'}</Button>
            <a className="inline-flex items-center gap-1 text-sm underline" href={appPath(`/guide/canvas/${steps[stepIndex].image}.png`)} target="_blank" rel="noreferrer">
              <ZoomIn className="size-4" />{ko ? '원본 크기로 보기' : 'View full size'}</a>
            <Button type="button" variant="outline" onClick={() => setStepIndex(index => index + 1)} disabled={stepIndex === steps.length - 1}>
              {ko ? '다음' : 'Next'}<ChevronRight className="size-4" /></Button>
          </div>
        <p className="text-xs text-muted-foreground">
          {ko ? 'Canvas 공식 안내의 화면입니다. 학교에 따라 다를 수 있습니다.' : 'Screenshots from the Canvas guide; your school’s screens may differ.'}{' '}
          <a className="underline" href="https://community.instructure.com/en/kb/articles/662901-how-do-i-manage-api-access-tokens-in-my-user-account" target="_blank" rel="noreferrer">{ko ? '원본 안내' : 'Original guide'}</a>
        </p>
        </section>
        <form onSubmit={submit} className="order-1 grid min-w-0 gap-4 rounded-xl border bg-muted/20 p-4 lg:sticky lg:top-0 lg:order-2">
          <h3 className="flex items-center gap-2 font-bold"><KeyRound className="size-4" />{ko ? '토큰 붙여넣고 연결' : 'Paste your token and connect'}</h3>
          <div className="grid gap-3">
            <div className="grid gap-2 text-sm font-semibold">
              <label htmlFor="canvas-school-select">{ko ? '학교' : 'School'}</label>
              <CanvasSchoolSelect id="canvas-school-select" schools={schools} disabled={isSaving}
                value={selectedSchool?.instanceUrl ?? (instanceUrl || isAdvancedOpen ? 'custom' : '')}
                placeholder={ko ? '학교를 선택하세요' : 'Select your school'}
                otherLabel={ko ? '다른 학교 · 고급 설정' : 'Other school · Advanced'}
                onValueChange={(value) => {
                  const custom = value === 'custom';
                  changeInstanceUrl(custom ? '' : value);
                  setIsAdvancedOpen(custom);
                }} />
            </div>
            <div className="flex items-end"><Button asChild variant="outline" disabled={!settingsUrl}>
              <a href={settingsUrl ?? undefined} aria-disabled={!settingsUrl} target="_blank" rel="noreferrer" onClick={(event) => { if (!settingsUrl) event.preventDefault(); }}><ExternalLink className="size-4" />{ko ? 'Canvas 설정 열기' : 'Open Canvas settings'}</a>
            </Button></div>
            <details className="group rounded-lg border p-3" open={isAdvancedOpen} onToggle={(event) => setIsAdvancedOpen(event.currentTarget.open)}>
              <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold">
                {ko ? '고급 설정' : 'Advanced'}<ChevronDown className="size-4 group-open:rotate-180" />
              </summary>
              <label className="mt-3 grid gap-2 text-sm font-semibold">{dictionary.canvasTokenInstanceUrl}
                <Input autoComplete="url" type="url" placeholder="https://your-school.instructure.com" value={instanceUrl}
                  onChange={(event) => changeInstanceUrl(event.target.value)} disabled={isSaving} />
              </label>
            </details>
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
      </div> : <p className="text-sm text-muted-foreground">{dictionary.canvasManualTokenDisabled}</p>}
      <div className="order-5 flex justify-end"><Button type="button" variant="outline" onClick={onContinue} disabled={isSaving}>{ko ? '나중에 연결하기' : 'Continue for now'}</Button></div>
    </div>
  );
}
