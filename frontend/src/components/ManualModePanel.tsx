import { useEffect, useState } from 'react';
import { canvasToDoApi, type ManualModeRequest } from '../api/canvasToDoApi';
import { useLanguage } from '../context/LanguageContext';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';

export function ManualModePanel() {
  const { language, dictionary } = useLanguage();
  const ko = language === 'ko';
  const [request, setRequest] = useState<ManualModeRequest | null>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    canvasToDoApi.manualModeRequest().then(value => { if (active) { setRequest(value); setLoaded(true); } })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : 'Unable to load request.'); });
    return () => { active = false; };
  }, []);
  const notices = ko ? [
    '앞으로 Canvas를 영구적으로 사용하지 않을 경우에만 요청하세요. 토큰이 만료되었다면 새 토큰을 발급해 계속 연결할 수 있습니다.',
    '승인 후에는 되돌릴 수 없습니다. 저장된 과목 정보는 수동 과목으로 전환되고 이 계정에서 Canvas를 다시 연결할 수 없습니다. 저장되지 않은 Canvas 정보는 가져올 수 없습니다.',
    '관리자가 검토하고 승인해야 하므로 시간이 걸립니다. 승인 전까지는 기존 과목이 Canvas에 연결된 상태로 유지됩니다.',
  ] : [
    'Request this only if you are leaving Canvas for good. If your token has expired, you can generate a new token and keep using Canvas.',
    'Once approved, this cannot be reversed. Your saved courses become manual courses and this account cannot reconnect to Canvas. Canvas data that was never saved here cannot be recovered.',
    'An administrator must review and approve your request, which takes time. Your courses remain linked to Canvas until approval.',
  ];
  const refresh = async () => {
    setBusy(true); setError('');
    try {
      const value = await canvasToDoApi.manualModeRequest();
      setRequest(value); setLoaded(true);
      if (value?.status === 'approved') window.location.reload();
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load request.'); }
    finally { setBusy(false); }
  };
  const submit = async () => {
    setBusy(true); setError('');
    try { setRequest(await canvasToDoApi.manualModeRequest(true)); setStep(0); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to send request.'); }
    finally { setBusy(false); }
  };
  return <section className="grid gap-3 rounded-lg border bg-card p-3">
    <h4 className="text-sm font-bold">{ko ? '영구 수동 모드' : 'Permanent manual mode'}</h4>
    {request?.status === 'approved' ? <p role="status" className="text-sm">{ko ? '승인됨. 이제 수동 과목으로 사용할 수 있습니다. Canvas를 다시 연결할 수 없습니다.' : 'Approved. Your saved courses are now manual. Canvas reconnection is disabled.'}</p>
      : request?.status === 'pending' ? <p role="status" className="text-sm">{ko ? '관리자 승인을 기다리는 중입니다. 검토에 시간이 걸릴 수 있습니다.' : 'Awaiting administrator approval. Review may take time.'}</p>
      : <>
        <p className="text-sm text-muted-foreground">{request?.status === 'rejected' ? (ko ? '이전 요청이 거절되었습니다. ' : 'Your previous request was declined. ') : ''}{ko ? 'Canvas를 더 이상 사용하지 않을 경우 저장된 과목의 수동 전환을 요청할 수 있습니다.' : 'If you are leaving Canvas permanently, request conversion of your saved courses to manual courses.'}</p>
        <Button className="justify-self-start" variant="outline" disabled={!loaded || busy} onClick={() => { setError(''); setStep(1); }}>{ko ? '수동 모드 요청' : 'Request manual mode'}</Button>
      </>}
    {(request?.status === 'pending' || !loaded) && <Button className="justify-self-start" variant="outline" disabled={busy} onClick={() => void refresh()}>{ko ? '요청 상태 새로고침' : 'Refresh request status'}</Button>}
    {error && !step && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Dialog open={step > 0} onOpenChange={open => { if (!open && !busy) setStep(0); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{ko ? '수동 모드 확인' : 'Confirm manual mode'} · {step}/3</DialogTitle>
          <DialogDescription>{notices[step - 1]}</DialogDescription></DialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setStep(0)}>{dictionary.cancel}</Button>
          <Button disabled={busy} onClick={() => { if (step < 3) setStep(step + 1); else void submit(); }}>
            {busy ? (ko ? '요청 중…' : 'Sending…') : step < 3 ? (ko ? '이해했습니다. 계속' : 'I understand, continue') : (ko ? '승인 요청 보내기' : 'Send approval request')}
          </Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}
