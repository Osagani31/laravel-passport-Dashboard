import { useEffect, useRef, useState } from 'react'
import './App.css'

type DashboardStats = {
  total_tasks: number
  completed_tasks: number
  pending_tasks: number
  completion_percentage: number
}

type TokenResponse = {
  access_token?: string
  token_type?: string
  expires_in?: number
  message?: string
}

const CLIENT_ID = '01a12b7c-1559-732f-a639-7211b225e0ed'
const REDIRECT_URI = 'http://localhost:5173/auth/callback'
const API_URL = 'http://to-do.test'

function base64UrlEncode(input: ArrayBuffer | Uint8Array) {
  const bytes =
    input instanceof ArrayBuffer ? new Uint8Array(input) : input

  let binary = ''

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function randomValue() {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)))
}

async function createCodeChallenge(verifier: string) {
  const data = new TextEncoder().encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)

  return base64UrlEncode(digest)
}

function App() {
  const [dashboardStats, setDashboardStats] =
    useState<DashboardStats | null>(null)

  const [accessToken, setAccessToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const callbackStarted = useRef(false)

  // Step 1: Start OAuth Authorization Code + PKCE flow
  async function signIn() {
    try {
      setLoading(true)
      setError('')

      const verifier = randomValue()
      const challenge = await createCodeChallenge(verifier)
      const state = randomValue()

      sessionStorage.setItem('pkce_verifier', verifier)
      sessionStorage.setItem('oauth_state', state)

      const authorizationUrl = new URL(
        `${API_URL}/oauth/authorize`,
      )

      authorizationUrl.search = new URLSearchParams({
        response_type: 'code',
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
      }).toString()

      window.location.assign(authorizationUrl.toString())
    } catch {
      setError('Unable to start sign-in. Please try again.')
      setLoading(false)
    }
  }

  // Step 2: Exchange authorization code for an access token
  useEffect(() => {
    if (window.location.pathname !== '/auth/callback') {
      return
    }

    if (callbackStarted.current) {
      return
    }

    callbackStarted.current = true

    async function handleCallback() {
      setLoading(true)
      setError('')

      try {
        const params = new URLSearchParams(window.location.search)

        const oauthError = params.get('error')

        if (oauthError) {
          throw new Error(
            params.get('error_description') ??
              'Authorization was not completed.',
          )
        }

        const code = params.get('code')
        const returnedState = params.get('state')
        const savedState = sessionStorage.getItem('oauth_state')
        const verifier = sessionStorage.getItem('pkce_verifier')

        if (
          !code ||
          !returnedState ||
          !savedState ||
          returnedState !== savedState ||
          !verifier
        ) {
          throw new Error(
            'Invalid OAuth callback. Please sign in again.',
          )
        }

        sessionStorage.removeItem('oauth_state')
        sessionStorage.removeItem('pkce_verifier')

        const response = await fetch(`${API_URL}/oauth/token`, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: CLIENT_ID,
            redirect_uri: REDIRECT_URI,
            code,
            code_verifier: verifier,
          }),
        })

        const tokenData: TokenResponse = await response.json()

        if (!response.ok || !tokenData.access_token) {
          throw new Error(
            tokenData.message ?? 'Failed to obtain access token.',
          )
        }

        // Remove the authorization code from the browser URL.
        window.history.replaceState({}, document.title, '/')

        setAccessToken(tokenData.access_token)
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'Authentication failed.',
        )
      } finally {
        setLoading(false)
      }
    }

    void handleCallback()
  }, [])

  // Step 3: Fetch dashboard data using the OAuth access token
  useEffect(() => {
    if (!accessToken) {
      return
    }

    const controller = new AbortController()

    async function fetchDashboardStats() {
      try {
        setLoading(true)
        setError('')

        const response = await fetch(
          `${API_URL}/api/dashboard/stats`,
          {
            headers: {
              Accept: 'application/json',
              Authorization: `Bearer ${accessToken}`,
            },
            signal: controller.signal,
          },
        )

        if (!response.ok) {
          if (response.status === 401) {
            throw new Error(
              'Authentication failed. Please sign in again.',
            )
          }

          throw new Error(
            `Failed to load dashboard (HTTP ${response.status}).`,
          )
        }

        const data: DashboardStats = await response.json()

        setDashboardStats(data)
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return
        }

        setError(
          err instanceof Error
            ? err.message
            : 'Something went wrong.',
        )
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      }
    }

    void fetchDashboardStats()

    return () => controller.abort()
  }, [accessToken])

  if (loading) {
    return (
      <main className="dashboard">
        <p>Loading...</p>
      </main>
    )
  }

  if (error) {
    return (
      <main className="dashboard">
        <h1>My Productivity Dashboard</h1>
        <p role="alert">{error}</p>
        <button onClick={signIn}>Sign in with Laravel</button>
      </main>
    )
  }

  if (!accessToken) {
    return (
      <main className="dashboard">
        <h1>My Productivity Dashboard</h1>
        <p>Sign in to view your personal task statistics.</p>
        <button onClick={signIn}>Sign in with Laravel</button>
      </main>
    )
  }

  if (!dashboardStats) {
    return (
      <main className="dashboard">
        <p>No dashboard statistics available.</p>
      </main>
    )
  }

  const {
    total_tasks: totalTasks,
    completed_tasks: completedTasks,
    pending_tasks: pendingTasks,
    completion_percentage: completionPercentage,
  } = dashboardStats

  const stats = [
    {
      title: 'Total Tasks',
      value: totalTasks,
      icon: '📋',
      description: 'All your tasks',
    },
    {
      title: 'Completed',
      value: completedTasks,
      icon: '✅',
      description: 'Tasks finished',
    },
    {
      title: 'Pending',
      value: pendingTasks,
      icon: '⏳',
      description: 'Tasks remaining',
    },
    {
      title: 'Completion',
      value: `${completionPercentage}%`,
      icon: '📈',
      description: 'Overall progress',
    },
  ]

  return (
    <main className="dashboard">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">PRODUCTIVITY OVERVIEW</p>
          <h1>My Productivity Dashboard</h1>
          <p className="subtitle">
            Track your progress and stay productive.
          </p>
        </div>

        <div className="status">
          <span className="status-dot"></span>
          Connected to Laravel API
        </div>
      </header>

      <section className="stats-grid" aria-label="Task statistics">
        {stats.map((stat) => (
          <article className="stat-card" key={stat.title}>
            <div className="card-top">
              <span className="stat-icon" aria-hidden="true">
                {stat.icon}
              </span>
              <span className="card-label">{stat.title}</span>
            </div>

            <p className="stat-value">{stat.value}</p>
            <p className="stat-description">{stat.description}</p>
          </article>
        ))}
      </section>

      <section className="progress-section">
        <div className="progress-heading">
          <div>
            <h2>Overall Progress</h2>
            <p>Keep going! Every completed task counts.</p>
          </div>

          <span className="progress-percentage">
            {completionPercentage}%
          </span>
        </div>

        <div
          className="progress-track"
          role="progressbar"
          aria-label="Task completion progress"
          aria-valuenow={completionPercentage}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="progress-fill"
            style={{ width: `${completionPercentage}%` }}
          />
        </div>

        <p className="progress-footer">
          {completedTasks} of {totalTasks} tasks completed
        </p>
      </section>

      <footer className="dashboard-footer">
        <span>Productivity Dashboard</span>
        <span>Powered by Laravel API</span>
      </footer>
    </main>
  )
}

export default App