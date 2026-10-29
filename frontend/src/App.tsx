import { useEffect, useState, type FormEvent } from 'react'
import { ArrowRight, CheckCircle2, Menu, Pause, Play, X } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { AcademicManagementPage, AdminStaffPage, PasswordRecoveryPage, SignInPage } from './AcademicManagement'
import { AccountantPage } from './Accountant'
import { requestJson } from './api'
import outingScene from './assets/WhatsApp Image 2026-10-24 at 21.06.40.jpeg'
import learningScene from './assets/WhatsApp Image 2026-10-24 at 21.06.45.jpeg'
import classroomScene from './assets/WhatsApp Image 2026-10-24 at 21.06.48.jpeg'
import './App.css'

type FormStatus = 'idle' | 'sending' | 'success' | 'error'

const grades = ['Nursery 1', 'Nursery 2', 'Nursery 3', 'Primary 1', 'Primary 2', 'Primary 3', 'Primary 4']
const heroScenes = [
  { image: outingScene, alt: 'Jabana students and teachers gathered outdoors for a school outing', caption: 'Growing together, everywhere.' },
  { image: learningScene, alt: 'Jabana students learning together with colorful classroom activities', caption: 'Learning through discovery.' },
  { image: classroomScene, alt: 'Jabana students learning together in their classroom', caption: 'A bright place to belong.' },
]

async function submitInquiry(endpoint: string, data: Record<string, string>): Promise<{ message: string }> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  const result: { message?: string } = await response.json()

  if (!response.ok) {
    throw new Error(result.message ?? 'We could not send your message. Please try again.')
  }
  return { message: result.message ?? 'Message received.' }
}

function App() {
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [admissionStatus, setAdmissionStatus] = useState<FormStatus>('idle')
  const [contactStatus, setContactStatus] = useState<FormStatus>('idle')
  const [contactSuccess, setContactSuccess] = useState('Message sent. Thank you for getting in touch!')
  const [activeScene, setActiveScene] = useState(0)
  const [isPlaying, setIsPlaying] = useState(
    () => !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  useEffect(() => {
    if (!isPlaying) return

    const interval = window.setInterval(() => {
      setActiveScene((current) => (current + 1) % heroScenes.length)
    }, 6000)

    return () => window.clearInterval(interval)
  }, [isPlaying])

  async function handleAdmissionSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAdmissionStatus('sending')
    const formElement = event.currentTarget
    const form = new FormData(formElement)

    try {
      await submitInquiry('/api/admissions', Object.fromEntries(
        [...form.entries()].map(([key, value]) => [key, String(value)]),
      ))
      setAdmissionStatus('success')
      formElement.reset()
    } catch {
      setAdmissionStatus('error')
    }
  }

  async function handleContactSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setContactStatus('sending')
    const formElement = event.currentTarget
    const form = new FormData(formElement)

    try {
      const result = await submitInquiry('/api/contact', Object.fromEntries(
        [...form.entries()].map(([key, value]) => [key, String(value)]),
      ))
      setContactSuccess(result.message)
      setContactStatus('success')
      formElement.reset()
    } catch {
      setContactStatus('error')
    }
  }

  function closeMenu() {
    setMenuOpen(false)
  }

  return (
    <>
      <header className="site-header">
        <a className="brand" href="#home" onClick={closeMenu} aria-label="JABANA BRIGHT ANGELS PRE AND PRIMARY SCHOOL home">
          <img className="brand-logo" src="/jabana-bright-angels-logo.jpg" alt="" />
          <span className="brand-name"><strong>JABANA BRIGHT ANGELS</strong><small>PRE AND PRIMARY SCHOOL</small></span>
        </a>
        <button
          className="menu-toggle"
          type="button"
          aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {menuOpen ? <X /> : <Menu />}
        </button>
        <nav className={menuOpen ? 'main-nav is-open' : 'main-nav'} aria-label="Main navigation">
          <div className="nav-about-group">
            <a href="#about" onClick={closeMenu}>About</a>
            <div className="nav-about-menu">
              <a href="#learning" onClick={closeMenu}>Learning</a>
              <a href="#contact" onClick={closeMenu}>Contact</a>
            </div>
          </div>
          <a href="#announcements" onClick={closeMenu}>Announcements</a>
          <Link to="/academic-management" onClick={closeMenu}>Academic Management</Link>
          <Link to="/accountant" onClick={closeMenu}>Accountant</Link>
          <a className="nav-cta" href="#admissions" onClick={closeMenu}>Admissions <ArrowRight size={16} /></a>
        </nav>
      </header>

      <main>
        {location.pathname === '/academic-management' ? <AcademicManagementPage />
          : location.pathname === '/accountant' ? <AccountantPage />
          : location.pathname === '/forgot-password' ? <PasswordRecoveryPage />
          : location.pathname === '/sign-in' ? <SignInPage />
            : location.pathname === '/admin/staff' ? <AdminStaffPage />
              : <>
        <section className="hero" id="home">
          <div className="hero-copy">
            <p className="eyebrow"><span></span> A place to learn and grow</p>
            <h1>We strive for<br /><em>a better future.</em></h1>
            <p className="hero-description">
              At Jabana Bright Angels, every child is known, encouraged, and inspired to discover what they can do.
            </p>
            <a className="button button-primary" href="#admissions">Start your journey <ArrowRight size={17} /></a>
            <div className="hero-note"><span className="note-line"></span> Learning together, every day.</div>
          </div>
          <div className="hero-art" role="group" aria-roledescription="carousel" aria-label="School life at Jabana Bright Angels">
            <div className="hero-scenes">
              {heroScenes.map((scene, index) => (
                <div
                  className={index === activeScene ? 'hero-scene is-active' : 'hero-scene'}
                  key={scene.image}
                  aria-hidden={index !== activeScene}
                >
                  <img src={scene.image} alt={scene.alt} />
                  <p className="art-caption">{scene.caption}</p>
                </div>
              ))}
            </div>
            <div className="hero-art-controls" aria-label="Slideshow controls">
              <div className="hero-scene-dots">
                {heroScenes.map((scene, index) => (
                  <button
                    aria-label={`Show scene ${index + 1}: ${scene.caption}`}
                    aria-pressed={index === activeScene}
                    className={index === activeScene ? 'hero-scene-dot is-active' : 'hero-scene-dot'}
                    key={scene.image}
                    onClick={() => setActiveScene(index)}
                    type="button"
                  />
                ))}
              </div>
              <button
                aria-label={isPlaying ? 'Pause slideshow' : 'Play slideshow'}
                className="hero-play-toggle"
                onClick={() => setIsPlaying(!isPlaying)}
                type="button"
              >
                {isPlaying ? <Pause size={14} /> : <Play size={14} />}
              </button>
            </div>
          </div>
        </section>

        <PublicAnnouncements />

        <section className="intro section-wrap" id="about">
          <div className="section-label">Welcome to Jabana Bright Angels</div>
          <h2>Big beginnings<br />happen <em>here.</em></h2>
          <p>We build strong foundations in a caring community where learning feels meaningful and every student has room to shine.</p>
          <div className="values">
            <article><span>01</span><h3>Learn with purpose</h3><p>Engaging lessons turn questions into confidence and knowledge into possibility.</p></article>
            <article><span>02</span><h3>Grow with kindness</h3><p>We help students build friendships, resilience, and respect for one another.</p></article>
            <article><span>03</span><h3>Find your spark</h3><p>Creative projects and new experiences help every child discover their strengths.</p></article>
          </div>
        </section>

        <section className="learning-section" id="learning">
          <div className="learning-inner">
            <div>
              <div className="section-label">Learning at Jabana Bright Angels</div>
              <h2>Strong roots.<br /><em>Open doors.</em></h2>
            </div>
            <div className="learning-copy">
              <p>From the first classroom steps through primary school, our supportive teachers help children build skills for school and for life.</p>
              <a className="text-link" href="#admissions">Find the right start <ArrowRight size={16} /></a>
            </div>
          </div>
          <div className="learning-strip"><span>Early years</span><span>Primary learning</span><span>Creative discovery</span><span>Community &amp; care</span></div>
        </section>

        <section className="admissions section-wrap" id="admissions">
          <div className="admission-copy">
            <div className="section-label">Take the next step</div>
            <h2>Let’s make<br />their next chapter <em>bright.</em></h2>
            <p>Tell us a little about your family. Our admissions team will be in touch to help you explore the right next step.</p>
            <div className="admission-promise"><CheckCircle2 size={19} /> A friendly conversation, with no commitment.</div>
          </div>
          <form className="inquiry-form" onSubmit={handleAdmissionSubmit}>
            <h3>Admission inquiry</h3>
            <label>Student’s name<input name="studentName" autoComplete="name" required maxLength={100} /></label>
            <label>Student’s class<select name="grade" defaultValue="" required><option value="" disabled>Select a class</option>{grades.map((grade) => <option key={grade}>{grade}</option>)}</select></label>
            <label>Parent or guardian<input name="guardianName" autoComplete="name" required maxLength={100} /></label>
            <div className="field-row">
              <label>Email address<input name="email" type="email" autoComplete="email" required maxLength={254} /></label>
              <label>Phone number<input name="phone" type="tel" autoComplete="tel" required maxLength={30} /></label>
            </div>
            <label>Anything you’d like us to know? <span className="optional">(optional)</span><textarea name="message" rows={3} maxLength={2000}></textarea></label>
            <button className="button button-primary form-button" disabled={admissionStatus === 'sending'}>
              {admissionStatus === 'sending' ? 'Sending…' : 'Send inquiry'} <ArrowRight size={17} />
            </button>
            <FormMessage status={admissionStatus} success="Thank you! Our admissions team will be in touch." />
          </form>
        </section>

        <section className="contact-section" id="contact">
          <div className="contact-inner">
            <div className="contact-copy">
              <div className="section-label">We’re here to help</div>
              <h2>Have a question?</h2>
              <p>Send us a note and the Jabana Bright Angels team will get back to you.</p>
            </div>
            <form className="contact-form" onSubmit={handleContactSubmit}>
              <div className="field-row">
                <label>Your name<input name="name" autoComplete="name" required maxLength={100} /></label>
                <label>Email address<input name="email" type="email" autoComplete="email" required maxLength={254} /></label>
              </div>
              <label>Subject<input name="subject" required maxLength={150} /></label>
              <label>Your message<textarea name="message" rows={4} required maxLength={3000}></textarea></label>
              <button className="button button-dark" disabled={contactStatus === 'sending'}>
                {contactStatus === 'sending' ? 'Sending…' : 'Send message'} <ArrowRight size={17} />
              </button>
              <FormMessage status={contactStatus} success={contactSuccess} />
            </form>
          </div>
        </section>
              </>}
      </main>

      <footer className="site-footer">
        <a className="brand" href="#home" aria-label="JABANA BRIGHT ANGELS PRE AND PRIMARY SCHOOL home">
          <img className="brand-logo" src="/jabana-bright-angels-logo.jpg" alt="" />
          <span className="brand-name"><strong>JABANA BRIGHT ANGELS</strong><small>PRE AND PRIMARY SCHOOL</small></span>
        </a>
        <span>Growing together, one day at a time.</span>
        <a href="#home">Back to top ↑</a>
      </footer>
    </>
  )
}

function FormMessage({ status, success }: { status: FormStatus; success: string }) {
  if (status !== 'success' && status !== 'error') return null
  return <p className={`form-message ${status}`} role="status">{status === 'success' ? success : 'We could not send your message. Please check your connection and try again.'}</p>
}

type PublicAnnouncement = { id: string; title: string; body: string; createdAt: string; authorRole: string }

function PublicAnnouncements() {
  const [announcements, setAnnouncements] = useState<PublicAnnouncement[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const result = await requestJson<{ announcements: PublicAnnouncement[] }>('/api/announcements')
        if (active) setAnnouncements(result.announcements)
      } catch {
        if (active) setFailed(true)
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => { active = false }
  }, [])

  return (
    <section className="announcements-section" id="announcements" aria-labelledby="public-announcements-heading">
      <div className="announcements-inner">
        {!loading && !failed && announcements.length > 0 && <div className="announcement-ticker" aria-label="Important school notices">
          <span className="announcement-ticker-label">N.B.</span>
          <div className="announcement-ticker-window" aria-hidden="true">
            <div className="announcement-ticker-track">
              {[0, 1].map((copy) => <div className="announcement-ticker-cycle" key={copy}>
                {announcements.map((announcement) => <span key={announcement.id}>{announcement.title}: {announcement.body}</span>)}
              </div>)}
            </div>
          </div>
          <span className="visually-hidden">Important school notices: {announcements.map((announcement) => `${announcement.title}: ${announcement.body}`).join('. ')}</span>
        </div>}
        <div className="announcements-heading"><p className="section-label">From the school</p><h2 id="public-announcements-heading">Announcements</h2></div>
        {loading ? <p className="announcement-empty">Loading school announcements…</p> : failed ? <p className="announcement-empty">Announcements are temporarily unavailable.</p> : announcements.length === 0 ? <p className="announcement-empty">There are no announcements right now.</p> : (
          <div className="public-announcement-list">{announcements.map((announcement) => {
            const source = announcement.authorRole === 'accountant' ? 'Accountant' : announcement.authorRole === 'dos_teacher' ? 'DOS & Teacher' : announcement.authorRole === 'dos' ? 'Director of Studies' : announcement.authorRole === 'administrator' ? 'School administration' : 'School'
            return <article className="public-announcement" key={announcement.id}>
              <div className="public-announcement-meta"><span>{source}</span><time dateTime={announcement.createdAt}>{new Date(announcement.createdAt).toLocaleDateString()}</time></div>
              <h3>{announcement.title}</h3>
              <p>{announcement.body}</p>
            </article>
          })}</div>
        )}
      </div>
    </section>
  )
}

export default App
