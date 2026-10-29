import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Archive, Bell, Boxes, CircleAlert, CircleCheck, CreditCard, FileText, LogOut, Plus, Printer, RefreshCw, ShieldCheck, Users } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { requestJson, requestNoContent } from './api'
import './Accountant.css'

type Role = 'administrator' | 'dos' | 'teacher' | 'dos_teacher' | 'accountant'
type User = { id: string; email: string; role: Role }
type Student = { id: string; name: string; grade: string; guardianName: string; guardianPhone: string; active: boolean }
type Payment = { id: string; amount: number; paidAt: string; reference: string }
type Fee = { id: string; studentId: string; academicYear: string; term: string; amountDue: number; paidTotal: number; balance: number; status: 'paid' | 'partial' | 'unpaid'; payments: Payment[] }
type FeeSchedule = { id: string; academicYear: string; grade: string; term: string; amountDue: number }
type Movement = { id: string; type: 'restock' | 'usage'; quantity: number; note: string; at: string }
type StockItem = { id: string; name: string; category: string; unit: string; quantity: number; lowStockThreshold: number; movements: Movement[] }
type Announcement = { id: string; title: string; body: string; published: boolean; createdAt: string }
type Dashboard = { students: Student[]; fees: Fee[]; feeSchedules: FeeSchedule[]; stockItems: StockItem[]; announcements: Announcement[] }
type MonthlyReport = {
  month: string
  totalCollected: number
  paymentCount: number
  payments: { id: string; studentName: string; grade: string; academicYear: string; term: string; amount: number; paidAt: string; reference: string }[]
}
type Tab = 'fees' | 'stock' | 'notices' | 'reports'

const grades = ['Nursery 1', 'Nursery 2', 'Nursery 3', 'Primary 1', 'Primary 2', 'Primary 3', 'Primary 4']
const terms = ['Term 1', 'Term 2', 'Term 3']
const money = new Intl.NumberFormat('en-RW', { style: 'currency', currency: 'RWF', maximumFractionDigits: 0 })

function formatMoney(value: number) {
  return money.format(value)
}

function currentMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export function AccountantPage() {
  const [user, setUser] = useState<User | null>(null)
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [reportMonth, setReportMonth] = useState(currentMonth)
  const [monthlyReport, setMonthlyReport] = useState<MonthlyReport | null>(null)
  const [reportLoading, setReportLoading] = useState(false)
  const [tab, setTab] = useState<Tab>('stock')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [selectedStock, setSelectedStock] = useState<string | null>(null)
  const [selectedFee, setSelectedFee] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const navigate = useNavigate()

  async function loadDashboard() {
    const result = await requestJson<Dashboard>('/api/accountant/dashboard')
    setDashboard(result)
  }

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const session = await requestJson<{ user: User }>('/api/auth/session')
        if (!active) return
        setUser(session.user)
        if (session.user.role === 'accountant' || session.user.role === 'administrator') {
          const data = await requestJson<Dashboard>('/api/accountant/dashboard')
          if (active) setDashboard(data)
        }
      } catch (loadError) {
        if (active && !(loadError instanceof Error && loadError.message === 'Sign in is required.')) {
          setError(loadError instanceof Error ? loadError.message : 'Accountant workspace could not be loaded.')
        }
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => { active = false }
  }, [])

  async function submitAction(event: FormEvent<HTMLFormElement>, path: string, successMessage: string) {
    event.preventDefault()
    const form = event.currentTarget
    const values: Record<string, FormDataEntryValue | number> = Object.fromEntries(new FormData(form).entries())
    for (const key of ['quantity', 'lowStockThreshold', 'amountDue', 'amount']) {
      if (typeof values[key] === 'string' && values[key] !== '') values[key] = Number(values[key])
    }
    setError('')
    setMessage('')
    setSaving(true)
    try {
      await requestJson(path, { method: 'POST', body: JSON.stringify(values) })
      form.reset()
      setSelectedStock(null)
      setSelectedFee(null)
      setMonthlyReport(null)
      await loadDashboard()
      setMessage(successMessage)
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'The change could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  async function generateMonthlyReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setMessage('')
    setReportLoading(true)
    setMonthlyReport(null)
    try {
      const report = await requestJson<MonthlyReport>(
        `/api/accountant/reports/monthly?month=${encodeURIComponent(reportMonth)}`,
      )
      setMonthlyReport(report)
    } catch (reportError) {
      setError(reportError instanceof Error ? reportError.message : 'Monthly report could not be generated.')
    } finally {
      setReportLoading(false)
    }
  }

  async function applyFeeSchedule(schedule: FeeSchedule) {
    setError('')
    setMessage('')
    setSaving(true)
    try {
      const result = await requestJson<{ message: string }>(
        `/api/accountant/fee-schedules/${schedule.id}/apply`,
        { method: 'POST' },
      )
      await loadDashboard()
      setMessage(result.message)
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'The class fee could not be applied.')
    } finally {
      setSaving(false)
    }
  }

  async function toggleAnnouncement(announcement: Announcement) {
    setError('')
    setMessage('')
    try {
      await requestJson(`/api/announcements/${announcement.id}`, {
        method: 'PATCH', body: JSON.stringify({ published: !announcement.published }),
      })
      await loadDashboard()
      setMessage(announcement.published ? 'Notice unpublished.' : 'Notice published.')
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Notice status could not be changed.')
    }
  }

  async function signOut() {
    try {
      await requestNoContent('/api/auth/logout', { method: 'POST' })
      navigate('/')
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Could not sign out.')
    }
  }

  if (loading) return <Status title="Checking access…" detail="Verifying your school account." />
  if (!user) return <Status title="Accountant sign-in required" detail={error || 'Sign in with an authorized accountant account to manage school records.'} action={<Link className="button button-primary" to="/sign-in" state={{ from: '/accountant' }}>Sign in securely</Link>} />
  if (user.role !== 'accountant' && user.role !== 'administrator') return <Status title="Accountant access required" detail="This workspace is available to accountant and administrator accounts." action={<Link className="button button-primary" to="/academic-management">Return to your workspace</Link>} />

  const students = dashboard?.students ?? []
  const fees = dashboard?.fees ?? []
  const stockItems = dashboard?.stockItems ?? []
  const announcements = dashboard?.announcements ?? []
  const lowStockCount = stockItems.filter((item) => item.quantity <= item.lowStockThreshold).length
  const outstanding = fees.reduce((total, fee) => total + fee.balance, 0)
  const movements = stockItems.flatMap((item) => item.movements.map((movement) => ({ ...movement, itemName: item.name, unit: item.unit })))
    .sort((first, second) => new Date(second.at).getTime() - new Date(first.at).getTime()).slice(0, 8)

  return (
    <section className="academic-page accountant-page">
      <div className="accountant-shell">
        <div className="accountant-heading">
          <div><p className="section-label">Finance &amp; resources</p><h1>Accountant <em>workspace.</em></h1><p className="dashboard-intro">Track school fees, record inventory movements, and share family notices.</p></div>
          <div className="accountant-user"><ShieldCheck size={16} /><span>{user.role === 'administrator' ? 'Administrator' : 'Accountant'} · {user.email}</span></div>
        </div>

        <div className="accountant-metrics" aria-label="Account overview">
          <div><Users size={18} /><span>Students</span><strong>{students.filter((student) => student.active).length}</strong></div>
          <div><CreditCard size={18} /><span>Outstanding fees</span><strong>{formatMoney(outstanding)}</strong></div>
          <div className={lowStockCount ? 'metric-alert' : ''}><Boxes size={18} /><span>Low stock items</span><strong>{lowStockCount}</strong></div>
        </div>

        <div className="accountant-toolbar">
          <div className="accountant-tabs" role="tablist" aria-label="Accountant sections">
            <button type="button" role="tab" aria-selected={tab === 'stock'} onClick={() => setTab('stock')}><Boxes size={16} /> Stock</button>
            <button type="button" role="tab" aria-selected={tab === 'fees'} onClick={() => setTab('fees')}><CreditCard size={16} /> Fees</button>
            <button type="button" role="tab" aria-selected={tab === 'notices'} onClick={() => setTab('notices')}><Bell size={16} /> Family notices</button>
            <button type="button" role="tab" aria-selected={tab === 'reports'} onClick={() => setTab('reports')}><FileText size={16} /> Monthly reports</button>
          </div>
          <button className="accountant-refresh" type="button" onClick={() => { setError(''); void loadDashboard().catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : 'Could not refresh records.')) }} aria-label="Refresh records"><RefreshCw size={15} /> Refresh</button>
        </div>

        {error && <p className="portal-error" role="alert">{error}</p>}
        {message && <p className="portal-success" role="status">{message}</p>}

        {tab === 'stock' && <section className="accountant-content" aria-label="Stock management">
          <div className="accountant-section-title"><div><p className="section-label">Inventory control</p><h2>Stock management</h2></div><span><Archive size={15} /> {stockItems.length} items recorded</span></div>
          <div className="accountant-columns">
            <form className="dashboard-panel accountant-form" onSubmit={(event) => void submitAction(event, '/api/accountant/stock', 'Stock item added.')}>
              <h3><Plus size={17} /> Add stock item</h3>
              <label>Item name<input name="name" required maxLength={100} placeholder="Exercise books" /></label>
              <div className="accountant-form-row"><label>Category<input name="category" required maxLength={60} placeholder="Learning materials" /></label><label>Unit<input name="unit" required maxLength={30} placeholder="packs" /></label></div>
              <div className="accountant-form-row"><label>Opening quantity<input name="quantity" type="number" min="0" max="100000000" step="1" required defaultValue="0" /></label><label>Low-stock alert at<input name="lowStockThreshold" type="number" min="0" max="100000000" step="1" required defaultValue="5" /></label></div>
              <button className="button button-primary" disabled={saving}>{saving ? 'Saving…' : 'Add item'}</button>
            </form>
            <section className="dashboard-panel stock-list-panel" aria-labelledby="stock-list-heading">
              <div className="stock-list-heading"><div><p className="section-label">On hand</p><h3 id="stock-list-heading">Inventory</h3></div><span className={lowStockCount > 0 ? 'is-low' : ''}>{lowStockCount > 0 ? <><CircleAlert size={15} /> {lowStockCount} need attention</> : <><CircleCheck size={15} /> Stock levels healthy</>}</span></div>
              {stockItems.length === 0 ? <p className="panel-hint">No stock items yet. Add an item to start tracking inventory.</p> : <div className="stock-table-wrap"><table className="accountant-table stock-table"><thead><tr><th>Item</th><th>Quantity</th><th>Level</th><th></th></tr></thead><tbody>{stockItems.map((item) => {
                const low = item.quantity <= item.lowStockThreshold
                return <tr key={item.id}><td><strong>{item.name}</strong><small>{item.category} · per {item.unit}</small></td><td>{item.quantity} {item.unit}</td><td><span className={low ? 'stock-status is-low' : 'stock-status'}>{low ? 'Low' : 'In stock'}</span></td><td><button className="table-action" type="button" aria-expanded={selectedStock === item.id} onClick={() => setSelectedStock(selectedStock === item.id ? null : item.id)}>Adjust</button></td></tr>
              })}</tbody></table>{selectedStock && <form className="movement-form" onSubmit={(event) => void submitAction(event, `/api/accountant/stock/${selectedStock}/movements`, 'Inventory movement recorded.')}>
                <label>Movement<select name="type" defaultValue="restock"><option value="restock">Restock</option><option value="usage">Record usage</option></select></label>
                <label>Quantity<input name="quantity" type="number" min="1" max="100000000" step="1" required /></label>
                <label>Note<input name="note" maxLength={150} placeholder="Optional details" /></label>
                <button className="button button-primary" disabled={saving}>{saving ? 'Saving…' : 'Record movement'}</button>
              </form>}</div>}
              {stockItems.length > 0 && <p className="panel-hint stock-hint">Usage cannot exceed available quantity. Low-stock alerts use each item’s threshold.</p>}
            </section>
          </div>
          <section className="dashboard-panel movement-history"><div className="panel-heading"><div><p className="section-label">Audit trail</p><h2>Recent stock movements</h2></div><Archive size={19} /></div>
            {movements.length === 0 ? <p className="panel-hint">Stock movements will appear here as inventory is recorded.</p> : <div className="stock-table-wrap"><table className="accountant-table"><thead><tr><th>Item</th><th>Movement</th><th>Quantity</th><th>Note</th><th>Date</th></tr></thead><tbody>{movements.map((movement) => <tr key={movement.id}><td>{movement.itemName}</td><td className={movement.type === 'restock' ? 'movement-in' : 'movement-out'}>{movement.type === 'restock' ? 'Restock' : 'Usage'}</td><td>{movement.type === 'restock' ? '+' : '−'}{movement.quantity} {movement.unit}</td><td>{movement.note || '—'}</td><td>{new Date(movement.at).toLocaleDateString()}</td></tr>)}</tbody></table></div>}
          </section>
        </section>}

        {tab === 'fees' && <section className="accountant-content" aria-label="School fees">
          <div className="accountant-section-title"><div><p className="section-label">Student accounts</p><h2>Fees &amp; payments</h2></div><span>{formatMoney(outstanding)} outstanding</span></div>
          <div className="accountant-columns fee-schedule-columns">
            <form className="dashboard-panel accountant-form" onSubmit={(event) => void submitAction(event, '/api/accountant/students', 'Student record added.')}>
              <h3><Plus size={17} /> Add student</h3>
              <label>Student name<input name="name" required maxLength={100} /></label>
              <label>Class<select name="grade" defaultValue="" required><option value="" disabled>Select a class</option>{grades.map((grade) => <option key={grade}>{grade}</option>)}</select></label>
              <label>Parent or guardian<input name="guardianName" maxLength={100} /></label>
              <label>Guardian phone<input name="guardianPhone" type="tel" maxLength={30} /></label>
              <button className="button button-primary" disabled={saving}>{saving ? 'Saving…' : 'Add student'}</button>
            </form>
            <form className="dashboard-panel accountant-form" onSubmit={(event) => void submitAction(event, '/api/accountant/fee-schedules', 'Class and term fee schedule saved.')}>
              <h3><CreditCard size={17} /> Set class fee</h3>
              <div className="accountant-form-row"><label>Academic year<input name="academicYear" required maxLength={20} placeholder="2026" /></label><label>Class<select name="grade" defaultValue="" required><option value="" disabled>Select a class</option>{grades.map((grade) => <option key={grade}>{grade}</option>)}</select></label></div>
              <div className="accountant-form-row"><label>Term<select name="term" defaultValue="Term 1">{terms.map((term) => <option key={term}>{term}</option>)}</select></label><label>Fee amount (RWF)<input name="amountDue" type="number" min="1" max="100000000" step="1" required /></label></div>
              <p className="panel-hint">Saving sets the standard fee for this class, term, and academic year. Apply it to create balances for active students; existing balances and payments are kept unchanged.</p>
              <button className="button button-primary" disabled={saving}>{saving ? 'Saving…' : 'Save class fee'}</button>
            </form>
          </div>
          <section className="dashboard-panel fee-list-panel"><div className="panel-heading"><div><p className="section-label">Standard charges</p><h2>Class fee schedules</h2></div><CreditCard size={19} /></div>
            {dashboard?.feeSchedules.length ? <div className="stock-table-wrap"><table className="accountant-table"><thead><tr><th>Academic year</th><th>Class</th><th>Term</th><th>Standard fee</th><th></th></tr></thead><tbody>{dashboard.feeSchedules.map((schedule) => <tr key={schedule.id}><td>{schedule.academicYear}</td><td>{schedule.grade}</td><td>{schedule.term}</td><td>{formatMoney(schedule.amountDue)}</td><td><button className="table-action" type="button" disabled={saving} onClick={() => void applyFeeSchedule(schedule)}>{saving ? 'Applying…' : 'Apply to students'}</button></td></tr>)}</tbody></table></div> : <p className="panel-hint">No class fee schedules yet. Save a class, term, and academic-year fee to begin.</p>}
          </section>
          <section className="dashboard-panel fee-list-panel"><div className="panel-heading"><div><p className="section-label">Fee ledger</p><h2>Student balances</h2></div><CreditCard size={19} /></div>
            {fees.length === 0 ? <p className="panel-hint">No fee records yet. Add a student, then create a term fee record.</p> : <div className="stock-table-wrap"><table className="accountant-table"><thead><tr><th>Student</th><th>Year / term</th><th>Fee</th><th>Paid</th><th>Balance</th><th>Status</th><th></th></tr></thead><tbody>{fees.map((fee) => {
              const student = students.find((candidate) => candidate.id === fee.studentId)
              return <tr key={fee.id}><td><strong>{student?.name ?? 'Student record'}</strong><small>{student?.grade ?? '—'}</small></td><td>{fee.academicYear}<small>{fee.term}</small></td><td>{formatMoney(fee.amountDue)}</td><td>{formatMoney(fee.paidTotal)}</td><td>{formatMoney(fee.balance)}</td><td><span className={`fee-status status-${fee.status}`}>{fee.status}</span></td><td>{fee.balance > 0 && <button className="table-action" type="button" aria-expanded={selectedFee === fee.id} onClick={() => setSelectedFee(selectedFee === fee.id ? null : fee.id)}>Record payment</button>}</td></tr>
            })}</tbody></table>{selectedFee && <form className="movement-form payment-form" onSubmit={(event) => void submitAction(event, `/api/accountant/fees/${selectedFee}/payments`, 'Payment recorded.')}>
              <label>Amount received (RWF)<input name="amount" type="number" min="1" max="100000000" step="1" required /></label><label>Receipt/reference<input name="reference" maxLength={100} placeholder="Optional reference" /></label><button className="button button-primary" disabled={saving}>{saving ? 'Saving…' : 'Save payment'}</button>
            </form>}</div>}
          </section>
        </section>}

        {tab === 'notices' && <section className="accountant-content" aria-label="Family notices">
          <div className="accountant-section-title"><div><p className="section-label">School communication</p><h2>Family notices</h2></div><span>Published notices appear on the school website</span></div>
          <div className="accountant-columns notice-columns">
            <form className="dashboard-panel accountant-form" onSubmit={(event) => void submitAction(event, '/api/announcements', 'Family notice published.')}>
              <h3><Bell size={17} /> Publish a notice</h3>
              <label>Title<input name="title" required maxLength={120} /></label>
              <label>Message<textarea name="body" rows={6} required maxLength={1500} /></label>
              <button className="button button-primary" disabled={saving}>{saving ? 'Publishing…' : 'Publish notice'}</button>
            </form>
            <section className="dashboard-panel notice-list"><h3>Notices</h3>{announcements.length === 0 ? <p className="panel-hint">No family notices have been created.</p> : announcements.map((announcement) => <article className="notice-item" key={announcement.id}><div><span className={announcement.published ? 'notice-state is-published' : 'notice-state'}>{announcement.published ? 'Published' : 'Unpublished'}</span><time>{new Date(announcement.createdAt).toLocaleDateString()}</time></div><h4>{announcement.title}</h4><p>{announcement.body}</p><button className="table-action" type="button" onClick={() => void toggleAnnouncement(announcement)}>{announcement.published ? 'Unpublish' : 'Publish'}</button></article>)}</section>
          </div>
        </section>}

        {tab === 'reports' && <section className="accountant-content monthly-report" aria-label="Monthly financial report">
          <div className="accountant-section-title"><div><p className="section-label">Finance summary</p><h2>Monthly collections report</h2></div><span>Fee payments received during the selected month</span></div>
          <form className="dashboard-panel report-controls" onSubmit={(event) => void generateMonthlyReport(event)}>
            <label htmlFor="report-month">Report month</label>
            <input id="report-month" type="month" required min="2000-01" max="2100-12" value={reportMonth} onChange={(event) => { setReportMonth(event.target.value); setMonthlyReport(null) }} />
            <button className="button button-primary" type="submit" disabled={reportLoading || !reportMonth}><FileText size={15} />{reportLoading ? 'Generating…' : 'Generate report'}</button>
            {monthlyReport && <button className="table-action print-report" type="button" onClick={() => window.print()}><Printer size={15} /> Print report</button>}
          </form>
          {monthlyReport && <div className="report-results">
            <div className="accountant-metrics report-metrics" aria-label="Monthly report totals">
              <div><CreditCard size={18} /><span>Total collected</span><strong>{formatMoney(monthlyReport.totalCollected)}</strong></div>
              <div><FileText size={18} /><span>Payments received</span><strong>{monthlyReport.paymentCount}</strong></div>
            </div>
            <section className="dashboard-panel fee-list-panel">
              <div className="panel-heading"><div><p className="section-label">{new Date(`${monthlyReport.month}-01T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</p><h2>Payment details</h2></div><CreditCard size={19} /></div>
              {monthlyReport.payments.length === 0 ? <p className="panel-hint">No fee payments were recorded during this month.</p> : <div className="stock-table-wrap"><table className="accountant-table"><thead><tr><th>Student</th><th>Class</th><th>Year / term</th><th>Amount</th><th>Reference</th><th>Date received</th></tr></thead><tbody>{monthlyReport.payments.map((payment) => <tr key={payment.id}><td>{payment.studentName}</td><td>{payment.grade || '—'}</td><td>{payment.academicYear}<small>{payment.term}</small></td><td>{formatMoney(payment.amount)}</td><td>{payment.reference || '—'}</td><td>{new Date(payment.paidAt).toLocaleDateString()}</td></tr>)}</tbody></table></div>}
            </section>
          </div>}
        </section>}

        <div className="accountant-footer"><Link to="/academic-management">Academic Management</Link><button className="sign-out-button" type="button" onClick={() => void signOut()}><LogOut size={15} /> Sign out</button></div>
      </div>
    </section>
  )
}

function Status({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return <section className="academic-page"><div className="auth-card status-card"><span className="platform-icon"><ShieldCheck size={21} /></span><h1>{title}</h1><p className="auth-intro">{detail}</p>{action}</div></section>
}
