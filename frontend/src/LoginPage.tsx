import { FormEvent, useState } from 'react'
import { Activity, LockKeyhole } from 'lucide-react'
import { api, type AuthUser } from './api'
import './login.css'

type LoginPageProps = { onLogin: (user: AuthUser) => void }

export function LoginPage({ onLogin }: LoginPageProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      onLogin(await api.login(email, password))
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Unable to sign in')
    } finally {
      setSubmitting(false)
    }
  }

  return <main className="login-screen">
    <section className="login-panel">
      <div className="login-brand"><span><Activity size={22} /></span><div>Smart Network<small>MONITORING CONSOLE</small></div></div>
      <p className="eyebrow">Secure operator access</p>
      <h1>Sign in to monitor your network</h1>
      <p className="panel-copy">Use an administrator or viewer account configured on the monitoring server.</p>
      <form onSubmit={submit}>
        <label>Email address<input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="username" required /></label>
        <label>Password<input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" required /></label>
        {error && <p className="form-error">{error}</p>}
        <button className="primary login-submit" disabled={submitting}><LockKeyhole size={16} />{submitting ? 'Signing in...' : 'Sign in'}</button>
      </form>
    </section>
  </main>
}
