import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Icon } from '../components/Icon';
import { useAuth } from '../features/auth/useAuth';
import { AuthError } from '../services/auth';

function CommunityArt() {
  return <svg className="community-art" viewBox="0 0 600 330" fill="none" aria-hidden="true">
    <defs><linearGradient id="art-fill" x1="300" y1="55" x2="300" y2="320" gradientUnits="userSpaceOnUse"><stop stopColor="#d6e4ba" stopOpacity=".1"/><stop offset="1" stopColor="#d6e4ba" stopOpacity=".02"/></linearGradient></defs>
    <circle cx="302" cy="161" r="132" stroke="currentColor" strokeOpacity=".1"/><circle cx="302" cy="161" r="108" stroke="currentColor" strokeOpacity=".08"/>
    <path d="M163 281V171l139-91 139 91v110H163Z" fill="url(#art-fill)" stroke="currentColor" strokeWidth="1.3"/>
    <path d="m148 179 154-101 154 101M302 79V42m-13 14h26" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    <path d="M269 281v-81a33 33 0 0 1 66 0v81m-33-114v114M195 227v-33a15 15 0 0 1 30 0v33h-30Zm184 0v-33a15 15 0 0 1 30 0v33h-30Z" stroke="currentColor" strokeWidth="1.3"/>
    <path d="M150 281h305m-293 9h281m-163 0-9 30m54-30 9 30M50 291c37-7 65-6 103-3m295 0c46-8 73-6 108 3" stroke="currentColor" strokeOpacity=".45"/>
    <path d="M111 280v-69m-1 43c-38-4-46-42-30-64 3 30 30 27 30 64Zm1-12c34-10 33-43 23-58-6 26-29 26-23 58ZM496 281v-68m0 43c36-5 43-40 28-62-3 29-28 26-28 62Zm0-17c-32-9-32-40-22-56 6 25 27 25 22 56Z" stroke="currentColor" strokeOpacity=".45" strokeWidth="1.2"/>
    <circle cx="453" cy="87" r="3" fill="currentColor" fillOpacity=".5"/><circle cx="133" cy="122" r="2" fill="currentColor" fillOpacity=".4"/>
  </svg>;
}

export function LoginPage() {
  const { session, loading, connectionError, login, logout } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string[]>>({});
  const helpDialog = useRef<HTMLDialogElement>(null);
  const submitGuard = useRef(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitGuard.current) return;
    submitGuard.current = true;
    setPending(true); setError(null); setFields({});
    try {
      await login({ email: email.trim(), password, rememberMe });
      setPassword(''); setShowPassword(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível entrar. Tente novamente.');
      if (cause instanceof AuthError) setFields(cause.fields);
    } finally { setPending(false); submitGuard.current = false; }
  }

  async function handleLogout() {
    setPending(true); setError(null);
    try { await logout(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível sair. Tente novamente.'); }
    finally { setPending(false); }
  }

  return <main className="auth-layout">
    <aside className="story-panel" aria-label="Gestão da igreja">
      <a className="brand" href="/" aria-label="Membros — início"><span className="brand-symbol"><Icon name="church" width="27" height="27"/></span><span>Membros<span className="brand-subtitle">GESTÃO DA IGREJA</span></span></a>
      <div className="story-content"><span className="eyebrow"><span className="eyebrow-line"/> PESSOAS NO CENTRO</span><h1>Uma comunidade.<br/>Cada pessoa <em>importa.</em></h1><p>Um lugar para organizar, cuidar e fortalecer<br className="desktop-break"/> os laços da sua igreja.</p><CommunityArt/></div>
      <div className="story-footer"><span className="small-spark">✦</span> Organização que aproxima.</div>
    </aside>
    <section className="login-panel" aria-label="Autenticação">
      <div className="access-tag"><span/> ÁREA ADMINISTRATIVA</div>
      <div className="login-content">
        {loading ? <div className="session-loading" role="status"><span className="spinner"/> Verificando sua sessão…</div> : session ? <div className="success-content">
          <span className="success-icon"><Icon name="check" width="28" height="28"/></span><span className="form-eyebrow">ACESSO CONFIRMADO</span><h2>Bem-vindo,<br/>{session.user.name.split(' ')[0]}.</h2><p className="form-description">Você está conectado à sua conta de administrador.</p>
          <div className="account-card"><span className="account-avatar">{session.user.name.slice(0, 1).toUpperCase()}</span><div><strong>{session.user.name}</strong><span>{session.user.email}</span></div><span className="account-badge">Admin</span></div>
          {error && <div className="form-alert" role="alert">{error}</div>}
          <button className="primary-button" onClick={handleLogout} disabled={pending}>{pending ? <><span className="spinner"/> Saindo…</> : <>Sair da conta <Icon name="logout"/></>}</button>
        </div> : <>
          <div className="form-heading"><span className="form-eyebrow">BEM-VINDO À SUA COMUNIDADE</span><h2>Bom ter você aqui.</h2><p className="form-description">Entre para acessar a gestão da sua igreja.</p></div>
          <form onSubmit={handleSubmit} className="login-form" aria-busy={pending}>
            <div className="field-group"><label htmlFor="email">E-mail</label><div className={`input-wrap${fields.email?.length ? ' invalid' : ''}`}><Icon name="mail"/><input id="email" name="email" type="email" autoComplete="username" placeholder="seuemail@exemplo.com" value={email} onChange={event => { setEmail(event.target.value); setFields(current => ({ ...current, email: [] })); }} required maxLength={254} disabled={pending} aria-invalid={Boolean(fields.email?.length)} aria-describedby={fields.email?.length ? 'email-error' : undefined}/></div>{fields.email?.length > 0 && <span className="field-error" id="email-error">{fields.email[0]}</span>}</div>
            <div className="field-group"><label htmlFor="password">Senha</label><div className={`input-wrap${fields.password?.length ? ' invalid' : ''}`}><Icon name="lock"/><input id="password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="Digite sua senha" value={password} onChange={event => { setPassword(event.target.value); setFields(current => ({ ...current, password: [] })); }} required maxLength={128} disabled={pending} aria-invalid={Boolean(fields.password?.length)} aria-describedby={fields.password?.length ? 'password-error' : undefined}/><button className="password-toggle" type="button" onClick={() => setShowPassword(value => !value)} disabled={pending} aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'} aria-pressed={showPassword}><Icon name={showPassword ? 'eye-off' : 'eye'}/></button></div>{fields.password?.length > 0 && <span className="field-error" id="password-error">{fields.password[0]}</span>}</div>
            <div className="form-options"><label className="checkbox-label"><input type="checkbox" checked={rememberMe} onChange={event => setRememberMe(event.target.checked)} disabled={pending}/><span>Manter conectado por 7 dias</span></label></div>
            {(error || connectionError) && <div className="form-alert" role="alert">{error ?? connectionError}</div>}
            <button className="primary-button" type="submit" disabled={pending}>{pending ? <><span className="spinner"/> Entrando…</> : <>Entrar na minha conta <Icon name="arrow"/></>}</button>
          </form>
          <div className="help-row"><span>Precisa de ajuda para entrar?</span><button type="button" onClick={() => helpDialog.current?.showModal()}>Orientações de acesso <span aria-hidden="true">↗</span></button></div>
        </>}
      </div>
      <footer className="login-footer"><Icon name="lock" width="14" height="14"/><span>Acesso exclusivo para administradores autorizados.</span></footer>
    </section>
    <dialog ref={helpDialog} className="help-dialog" aria-labelledby="help-title"><button className="dialog-close" type="button" onClick={() => helpDialog.current?.close()} aria-label="Fechar orientações"><Icon name="close"/></button><span className="form-eyebrow">ESTAMOS AQUI PARA AJUDAR</span><h2 id="help-title">Seu acesso à igreja.</h2><p>As contas são criadas pelo responsável pelo sistema da sua igreja. Se você ainda não tem uma conta ou esqueceu sua senha, entre em contato com ele para receber orientação.</p><button className="primary-button" type="button" onClick={() => helpDialog.current?.close()}>Entendi <Icon name="check"/></button></dialog>
  </main>;
}
