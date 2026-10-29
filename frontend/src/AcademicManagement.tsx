import { useEffect, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight, Bell, BookOpenCheck, CalendarDays, Check, CheckCircle2, ExternalLink, FileText, LockKeyhole, LogOut, Plus, Printer, Send, ShieldCheck, Trash2, Upload, Users } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { requestJson, requestNoContent } from './api'
import './AcademicManagement.css'

type Role = 'administrator' | 'dos' | 'teacher' | 'dos_teacher' | 'accountant'
type SchoolUser = { id: string; email: string; role: Role; active: boolean; createdAt?: string }
type Task = { key: string; title: string; deadline: string | null; completedAt: string | null }
type Activity = { id: string; text: string; at: string }
type RegisteredStudent = { id: string; name: string; grade: string; guardianName: string; guardianPhone: string; sdmsCode: string; active: boolean }
type AdmissionInquiry = { id: string; studentName: string; grade: string; guardianName: string; email: string; phone: string; message: string; status: string; createdAt: string }
type ContactQuestion = { id: string; name: string; email: string; subject: string; message: string; createdAt: string }
type TeacherMember = { id: string; email: string; role: Role; studies: string; assignedCourses: string[] }
type PendingTeacher = { id: string; email: string; role: Role; studies: string }
type TeacherProfile = { name: string; studies: string; approved: boolean; assignedCourses: string[] }
type TeacherMark = { id: string; studentNumber: string; studentName: string; classGrade: string; subjectName: string; assessmentType: string; assessmentName: string; marksObtained: number; maxMarks: number; calculatedGrade: string; gradePoints: number | null; term: string; academicYear: string; remarks: string }
type TimetableSlot = { day: string; period: number; startsAt: string; endsAt: string; grade: string; subject: string; teacherId: string; teacherEmail: string }
type TeachingAssignment = { id: string; teacherId: string; teacherEmail: string; grade: string; subject: string; periodsPerWeek: number }
type TeacherDashboardData = { profile: TeacherProfile; marks: TeacherMark[]; marksTruncated: boolean; timetable: Array<Pick<TimetableSlot, 'day' | 'period' | 'startsAt' | 'endsAt' | 'grade' | 'subject'>> }
type DashboardData = { schoolName: string | null; academicYear: string | null; tasks: Task[]; activity: Activity[]; students: RegisteredStudent[]; admissions: AdmissionInquiry[]; teachers: TeacherMember[]; pendingTeachers: PendingTeacher[]; contactQuestions: ContactQuestion[] }
type GmailConnectionStatus = { configured: boolean; missingSettings: string[]; connected: boolean; method: 'gmail' | null; email: string | null; connectedAt: string | null; connectionError: string | null }
type StudentSection = 'students' | 'admissions' | 'teachers' | 'questions' | 'marks' | 'timetable'

const teacherCourses = ['Kinyarwanda', 'French', 'Social Studies', 'Religious Education', 'Maths', 'English', 'Science', 'Art and Drama', 'Creative Arts', 'Science and Elementary Technology (SET)', 'Social & Religious Studies']

const platforms = [
  {
    title: 'CAMIS',
    fullTitle: 'Comprehensive Assessment Management Information System',
    description: 'Access the official assessment platform to enter and manage student assessment marks and generate report cards according to your authorized responsibilities.',
    url: 'https://camis.nesa.gov.rw/login',
    icon: FileText,
  },
  {
    title: 'SDMS',
    fullTitle: 'School Data Management System',
    description: 'Access the official school data platform and use the academic and examination services assigned to your account.',
    url: 'https://sdms.gov.rw/',
    icon: Users,
  },
]

function roleName(role: Role) {
  return role === 'dos_teacher' ? 'Director of Studies & Teacher' : role === 'dos' ? 'Director of Studies' : role === 'administrator' ? 'Administrator' : role === 'accountant' ? 'Accountant' : 'Teacher'
}

export function AcademicManagementPage() {
  const [user, setUser] = useState<SchoolUser | null>(null)
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyTask, setBusyTask] = useState<string | null>(null)
  const [busyAdmission, setBusyAdmission] = useState<string | null>(null)
  const [busyTeacher, setBusyTeacher] = useState<string | null>(null)
  const [busyQuestion, setBusyQuestion] = useState<string | null>(null)
  const [busyStudent, setBusyStudent] = useState<string | null>(null)
  const [editingStudent, setEditingStudent] = useState<RegisteredStudent | null>(null)
  const [teacherDisplayName, setTeacherDisplayName] = useState('')
  const [emailFallback, setEmailFallback] = useState<{ questionId: string; href: string; recipient: string } | null>(null)
  const [studentSection, setStudentSection] = useState<StudentSection>('students')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const navigate = useNavigate()

  async function loadDashboard() {
    const result = await requestJson<DashboardData>('/api/dos/dashboard')
    setDashboard(result)
  }

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const result = await requestJson<{ user: SchoolUser }>('/api/auth/session')
        if (!active) return
        setUser(result.user)
        if (result.user.role === 'dos' || result.user.role === 'dos_teacher' || result.user.role === 'administrator') {
          const data = await requestJson<DashboardData>('/api/dos/dashboard')
          if (active) setDashboard(data)
        }
      } catch (requestError) {
        if (!active) return
        if (requestError instanceof Error && requestError.message === 'Sign in is required.') {
          setUser(null)
        } else {
          setError(requestError instanceof Error ? requestError.message : 'The dashboard could not be loaded.')
        }
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => { active = false }
  }, [])

  async function updateTask(task: Task) {
    setBusyTask(task.key)
    setError('')
    try {
      await requestJson(`/api/dos/tasks/${task.key}`, {
        method: 'PATCH',
        body: JSON.stringify({ completed: !task.completedAt }),
      })
      await loadDashboard()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The checklist could not be updated.')
    } finally {
      setBusyTask(null)
    }
  }

  async function registerAdmission(event: FormEvent<HTMLFormElement>, inquiry: AdmissionInquiry) {
    event.preventDefault()
    const form = event.currentTarget
    const sdmsCode = new FormData(form).get('sdmsCode')
    if (typeof sdmsCode !== 'string') return
    setBusyAdmission(inquiry.id)
    setError('')
    setMessage('')
    try {
      const result = await requestJson<{ emailConfirmation: { sent: boolean; message: string } }>(`/api/dos/admissions/${inquiry.id}/register`, {
        method: 'POST',
        body: JSON.stringify({ sdmsCode }),
      })
      await loadDashboard()
      setMessage(`${inquiry.studentName} was registered and linked to the admission inquiry. ${result.emailConfirmation.message}`)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The student could not be registered.')
    } finally {
      setBusyAdmission(null)
    }
  }

  async function updateStudent(student: RegisteredStudent) {
    setBusyStudent(student.id)
    setError('')
    setMessage('')
    try {
      await requestJson(`/api/dos/students/${student.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: student.name,
          grade: student.grade,
          sdmsCode: student.sdmsCode,
          guardianName: student.guardianName,
          guardianPhone: student.guardianPhone,
          active: student.active,
        }),
      })
      await loadDashboard()
      setEditingStudent(null)
      setMessage(`${student.name}’s record was updated.`)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The student record could not be updated.')
    } finally {
      setBusyStudent(null)
    }
  }

  async function deleteStudent(student: RegisteredStudent) {
    if (!window.confirm(`Permanently delete the student record for ${student.name}?`)) return
    setBusyStudent(student.id)
    setError('')
    setMessage('')
    try {
      await requestNoContent(`/api/dos/students/${student.id}`, { method: 'DELETE' })
      await loadDashboard()
      setMessage(`${student.name}’s record was deleted.`)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The student record could not be deleted.')
    } finally {
      setBusyStudent(null)
    }
  }

  async function reviewTeacher(teacher: { id: string; email?: string }, approved: boolean, courses: string[] = []) {
    setBusyTeacher(teacher.id)
    setError('')
    setMessage('')
    try {
      const result = await requestJson<{ message: string }>(`/api/dos/teachers/${teacher.id}/approval`, {
        method: 'PATCH',
        body: JSON.stringify({ approved, ...(approved ? { courses } : {}) }),
      })
      await loadDashboard()
      setMessage(result.message)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Teacher group membership could not be updated.')
    } finally {
      setBusyTeacher(null)
    }
  }

  async function approveTeacher(event: FormEvent<HTMLFormElement>, teacher: PendingTeacher) {
    event.preventDefault()
    const courses = new FormData(event.currentTarget).getAll('courses')
    if (courses.length === 0) {
      setError('Select at least one preferred course before approving this teacher.')
      return
    }
    await reviewTeacher(teacher, true, courses.filter((course): course is string => typeof course === 'string'))
  }

  async function assignTeacherCourses(event: FormEvent<HTMLFormElement>, teacher: TeacherMember) {
    event.preventDefault()
    const courses = new FormData(event.currentTarget).getAll('courses')
    setBusyTeacher(teacher.id)
    setError('')
    setMessage('')
    try {
      await requestJson(`/api/dos/teachers/${teacher.id}/courses`, {
        method: 'PUT',
        body: JSON.stringify({ courses }),
      })
      await loadDashboard()
      setMessage(`Course assignments updated for ${teacher.email}.`)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Teacher courses could not be assigned.')
    } finally {
      setBusyTeacher(null)
    }
  }

  async function replyToQuestion(event: FormEvent<HTMLFormElement>, question: ContactQuestion) {
    event.preventDefault()
    const form = event.currentTarget
    const reply = new FormData(form).get('reply')
    if (typeof reply !== 'string' || !reply.trim()) {
      setError('Write a reply before sending.')
      return
    }
    setBusyQuestion(question.id)
    setError('')
    setMessage('')
    setEmailFallback(null)
    try {
      const result = await requestJson<{ message: string }>(`/api/dos/contact-questions/${question.id}/reply`, {
        method: 'POST',
        body: JSON.stringify({ reply }),
      })
      form.reset()
      setMessage(result.message)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The email reply could not be sent.')
      const subject = `Re: ${question.subject}`
      const body = `Hello ${question.name},\n\n${reply.trim()}\n\n---\nYour original message: ${question.message}`
      setEmailFallback({
        questionId: question.id,
        recipient: question.email,
        href: `mailto:${encodeURIComponent(question.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
      })
    } finally {
      setBusyQuestion(null)
    }
  }

  async function dismissQuestion(question: ContactQuestion) {
    setBusyQuestion(question.id)
    setError('')
    setMessage('')
    try {
      const result = await requestJson<{ message: string }>(`/api/dos/contact-questions/${question.id}/dismiss`, {
        method: 'PATCH',
      })
      await loadDashboard()
      setMessage(`${result.message} The message is retained in the database.`)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The user question could not be dismissed.')
    } finally {
      setBusyQuestion(null)
    }
  }

  async function signOut() {
    setError('')
    try {
      await requestNoContent('/api/auth/logout', { method: 'POST' })
      navigate('/')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not sign out.')
    }
  }

  if (loading) return <StatusPanel title="Checking access…" detail="Verifying your school account." />
  if (error && !user) {
    return <StatusPanel title="Dashboard unavailable" detail={error} action={<button className="button button-primary" onClick={() => window.location.reload()}>Try again</button>} />
  }
  if (!user) {
    return <StatusPanel title="School staff sign-in required" detail="Sign in with an authorized school account to access academic management." action={<Link className="button button-primary" to="/sign-in" state={{ from: '/academic-management' }}>Sign in securely</Link>} />
  }
  if (user.role === 'teacher') {
    return (
      <section className="academic-page">
        <div className="academic-shell teacher-workspace">
          <div className="dashboard-heading">
            <div><p className="section-label">Teacher workspace</p><h1>Welcome{teacherDisplayName ? `, ${teacherDisplayName}` : ''}<br /><em>Your teaching dashboard.</em></h1><p className="dashboard-intro">View your assigned subjects and teaching timetable. Submit your studies for review to access approved teaching tools.</p></div>
            <div className="dashboard-school"><div className="signed-in"><ShieldCheck size={15} /> Teacher · {user.email}</div></div>
          </div>
          <PlatformAccessSection />
          <TeacherProfileCard onNameChange={setTeacherDisplayName} />
          <PasswordChangeForm />
          <button className="sign-out-button" type="button" onClick={() => void signOut()}><LogOut size={15} /> Sign out</button>
        </div>
      </section>
    )
  }
  if (user.role === 'accountant') {
    return <StatusPanel title="Accountant workspace" detail="This account has accountant access. Open the Accountant tab to manage fees, stock, and family announcements." action={<Link className="button button-primary" to="/accountant">Open accountant workspace</Link>} />
  }

  return (
    <section className="academic-page">
      <div className="academic-shell">
        <div className="dashboard-heading">
          <div>
            <p className="section-label">Academic management</p>
            <h1>Welcome to the<br /><em>Director of Studies Dashboard.</em></h1>
            <p className="dashboard-intro">A secure workspace for academic coordination. Use your own authorized account on each official government platform.</p>
          </div>
          <div className="dashboard-school">
            <span><BookOpenCheck size={18} /> School</span>
            <strong>{dashboard?.schoolName || 'JABANA BRIGHT ANGELS PRE AND PRIMARY SCHOOL'}</strong>
            <span><CalendarDays size={16} /> Academic year</span>
            <strong>{dashboard?.academicYear || 'Academic year not configured'}</strong>
            <div className="signed-in"><ShieldCheck size={15} /> {roleName(user.role)} · {user.email}</div>
          </div>
        </div>

        {error && <p className="portal-error" role="alert">{error}</p>}
        {message && <p className="portal-success" role="status">{message}</p>}

        <PlatformAccessSection />
        <GmailConnectionPanel />

        <div className="student-management-tabs">
          <div className="student-section-tabs" role="tablist" aria-label="School management">
            <button id="registered-students-tab" type="button" role="tab" aria-selected={studentSection === 'students'} aria-controls="registered-students-panel" onClick={() => setStudentSection('students')}><Users size={15} /> Registered students</button>
            <button id="admission-inquiries-tab" type="button" role="tab" aria-selected={studentSection === 'admissions'} aria-controls="admission-inquiries-panel" onClick={() => setStudentSection('admissions')}><FileText size={15} /> Admission inquiries{dashboard?.admissions.filter((inquiry) => inquiry.status !== 'registered').length ? ` (${dashboard.admissions.filter((inquiry) => inquiry.status !== 'registered').length})` : ''}</button>
            <button id="teachers-group-tab" type="button" role="tab" aria-selected={studentSection === 'teachers'} aria-controls="teachers-group-panel" onClick={() => setStudentSection('teachers')}><Users size={15} /> Teachers group{dashboard?.pendingTeachers.length ? ` (${dashboard.pendingTeachers.length} pending)` : ''}</button>
            <button id="user-questions-tab" type="button" role="tab" aria-selected={studentSection === 'questions'} aria-controls="user-questions-panel" onClick={() => setStudentSection('questions')}><Bell size={15} /> User questions{dashboard?.contactQuestions.length ? ` (${dashboard.contactQuestions.length})` : ''}</button>
            <button id="marks-reports-tab" type="button" role="tab" aria-selected={studentSection === 'marks'} aria-controls="marks-reports-panel" onClick={() => setStudentSection('marks')}><FileText size={15} /> Marks &amp; reports</button>
            <button id="timetable-tab" type="button" role="tab" aria-selected={studentSection === 'timetable'} aria-controls="timetable-panel" onClick={() => setStudentSection('timetable')}><CalendarDays size={15} /> Timetables</button>
          </div>
          {studentSection === 'students' ? <section className="dashboard-panel registered-students-panel" id="registered-students-panel" role="tabpanel" aria-labelledby="registered-students-tab">
            <div className="panel-heading">
              <div><p className="section-label">Student records</p><h2>Registered students</h2></div>
              <Users size={20} />
            </div>
            {dashboard?.students.length ? <div className="student-table-wrap"><table className="student-table"><thead><tr><th>Student</th><th>Class</th><th>SDMS code</th><th>Guardian</th><th>Phone</th><th>Status</th><th>Actions</th></tr></thead><tbody>
              {dashboard.students.map((student) => {
                const isEditing = editingStudent?.id === student.id
                const currentStudent = isEditing ? editingStudent : student
                return <tr key={student.id}>
                  <td>{isEditing ? <input aria-label="Student name" maxLength={100} required value={currentStudent.name} onChange={(event) => setEditingStudent({ ...currentStudent, name: event.target.value })} /> : student.name}</td>
                  <td>{isEditing ? <select aria-label="Class" value={currentStudent.grade} onChange={(event) => setEditingStudent({ ...currentStudent, grade: event.target.value })}>{['Nursery 1', 'Nursery 2', 'Nursery 3', 'Primary 1', 'Primary 2', 'Primary 3', 'Primary 4'].map((grade) => <option key={grade}>{grade}</option>)}</select> : student.grade}</td>
                  <td>{isEditing ? <input aria-label="SDMS code" maxLength={50} required value={currentStudent.sdmsCode} onChange={(event) => setEditingStudent({ ...currentStudent, sdmsCode: event.target.value })} /> : student.sdmsCode || 'Not recorded'}</td>
                  <td>{isEditing ? <input aria-label="Guardian name" maxLength={100} value={currentStudent.guardianName} onChange={(event) => setEditingStudent({ ...currentStudent, guardianName: event.target.value })} /> : student.guardianName || '—'}</td>
                  <td>{isEditing ? <input aria-label="Guardian phone" maxLength={30} value={currentStudent.guardianPhone} onChange={(event) => setEditingStudent({ ...currentStudent, guardianPhone: event.target.value })} /> : student.guardianPhone || '—'}</td>
                  <td>{isEditing ? <label className="student-active-toggle"><input type="checkbox" checked={currentStudent.active} onChange={(event) => setEditingStudent({ ...currentStudent, active: event.target.checked })} /> Active</label> : student.active ? 'Active' : 'Inactive'}</td>
                  <td className="student-actions-cell">{isEditing ? <>
                    <button className="student-table-action" type="button" disabled={busyStudent !== null} onClick={() => void updateStudent(currentStudent)}>{busyStudent === student.id ? 'Saving…' : 'Save'}</button>
                    <button className="student-table-action" type="button" disabled={busyStudent !== null} onClick={() => setEditingStudent(null)}>Cancel</button>
                  </> : <>
                    <button className="student-table-action" type="button" disabled={busyStudent !== null || editingStudent !== null} onClick={() => setEditingStudent({ ...student })}>Update</button>
                    <button className="student-table-action is-delete" type="button" disabled={busyStudent !== null || editingStudent !== null} onClick={() => void deleteStudent(student)}>{busyStudent === student.id ? 'Deleting…' : 'Delete'}</button>
                  </>}</td>
                </tr>
              })}
            </tbody></table></div> : <p className="panel-hint">No student records are registered in this system yet.</p>}
          </section> : studentSection === 'admissions' ? <section className="dashboard-panel admissions-panel" id="admission-inquiries-panel" role="tabpanel" aria-labelledby="admission-inquiries-tab">
            <div className="panel-heading">
              <div><p className="section-label">Admissions</p><h2>Admission inquiries</h2></div>
              <FileText size={20} />
            </div>
            <p className="panel-hint">Register admitted students here. Enter the official SDMS code issued by the SDMS portal; this website does not generate or verify that code.</p>
            {!dashboard?.admissions.filter((inquiry) => inquiry.status !== 'registered').length ? <p className="panel-hint">There are no unregistered admission inquiries.</p> : <div className="admission-inquiry-list">
              {dashboard.admissions.filter((inquiry) => inquiry.status !== 'registered').map((inquiry) => <article className="admission-inquiry" key={inquiry.id}>
                <div className="admission-inquiry-details">
                  <strong>{inquiry.studentName} · {inquiry.grade}</strong>
                  <span>Guardian: {inquiry.guardianName} · {inquiry.phone} · {inquiry.email}</span>
                  {inquiry.message && <p>{inquiry.message}</p>}
                  <small>Received {new Date(inquiry.createdAt).toLocaleDateString()} · {inquiry.status}</small>
                </div>
                <form className="register-student-form" onSubmit={(event) => void registerAdmission(event, inquiry)}>
                  <label htmlFor={`sdms-code-${inquiry.id}`}>Official SDMS code</label>
                  <input id={`sdms-code-${inquiry.id}`} name="sdmsCode" maxLength={50} required placeholder="Enter code issued by SDMS" />
                  <button className="button button-primary" type="submit" disabled={busyAdmission !== null}>{busyAdmission === inquiry.id ? 'Registering…' : 'Register student'}</button>
                </form>
              </article>)}
            </div>}
          </section> : studentSection === 'teachers' ? <section className="dashboard-panel teachers-group-panel" id="teachers-group-panel" role="tabpanel" aria-labelledby="teachers-group-tab">
            <div className="panel-heading"><div><p className="section-label">Course assignment</p><h2>Teachers group</h2></div><Users size={20} /></div>
            <p className="panel-hint">Teachers submit their studies. DOS/admin can approve pending studies and assign preferred courses from the available subjects.</p>
            {user.role === 'dos_teacher' && <TeacherProfileCard onSaved={loadDashboard} />}
            <section className="teacher-review-list" aria-label="Teachers awaiting approval">
              <h3>Pending teacher studies</h3>
              {dashboard?.pendingTeachers.length ? dashboard.pendingTeachers.map((teacher) => <article className="teacher-review-row teacher-course-row" key={teacher.id}>
                <div><strong>{teacher.email}</strong><span>Studies: {teacher.studies}</span></div>
                <form className="teacher-course-form pending-teacher-form" onSubmit={(event) => void approveTeacher(event, teacher)}>
                  <fieldset><legend>Preferred courses for this teacher</legend><div className="teacher-course-options">{teacherCourses.map((course) => <label key={course}><input type="checkbox" name="courses" value={course} />{course}</label>)}</div></fieldset>
                  <button className="button button-primary" type="submit" disabled={busyTeacher !== null}>{busyTeacher === teacher.id ? 'Approving…' : 'Approve and assign courses'}</button>
                </form>
              </article>) : <p className="panel-hint">No teachers are awaiting approval.</p>}
            </section>
            <section className="teacher-review-list" aria-label="Approved Teachers group">
              <h3>Approved teachers</h3>
              {dashboard?.teachers.length ? dashboard.teachers.map((teacher) => <article className="teacher-review-row teacher-course-row" key={teacher.id}>
                <div className="teacher-review-details"><strong>{teacher.email}</strong><span>Studies: {teacher.studies || 'Not provided'}</span></div>
                <form className="teacher-course-form" onSubmit={(event) => void assignTeacherCourses(event, teacher)}>
                  <fieldset><legend>Assigned courses</legend><div className="teacher-course-options">{teacherCourses.map((course) => <label key={course}><input type="checkbox" name="courses" value={course} defaultChecked={teacher.assignedCourses.includes(course)} />{course}</label>)}</div></fieldset>
                  <button className="button button-primary" type="submit" disabled={busyTeacher !== null}>{busyTeacher === teacher.id ? 'Saving…' : 'Save assignments'}</button>
                  {user.role === 'administrator' && <button className="staff-status-button" type="button" disabled={busyTeacher !== null} onClick={() => void reviewTeacher({ ...teacher }, false)}>{busyTeacher === teacher.id ? 'Saving…' : 'Remove from group'}</button>}
                </form>
              </article>) : <p className="panel-hint">No teachers have been approved for the group yet.</p>}
            </section>
          </section> : studentSection === 'questions' ? <section className="dashboard-panel questions-panel" id="user-questions-panel" role="tabpanel" aria-labelledby="user-questions-tab">
            <div className="panel-heading"><div><p className="section-label">Messages from the website</p><h2>User questions</h2></div><Bell size={20} /></div>
            {dashboard?.contactQuestions.length ? <div className="contact-question-list">
              {dashboard.contactQuestions.map((question) => <article className="contact-question" key={question.id}>
                <div className="contact-question-heading">
                  <div><h3>{question.subject}</h3><span>From {question.name} · <a href={`mailto:${question.email}`}>{question.email}</a></span></div>
                  <div className="contact-question-actions"><time dateTime={question.createdAt}>{new Date(question.createdAt).toLocaleString()}</time><button className="contact-question-dismiss" type="button" disabled={busyQuestion !== null} onClick={() => void dismissQuestion(question)}>{busyQuestion === question.id ? 'Dismissing…' : 'Dismiss'}</button></div>
                </div>
                <p>{question.message}</p>
                <form className="contact-question-reply" onSubmit={(event) => void replyToQuestion(event, question)}>
                  <p className="contact-reply-routing">This reply is sent from the configured school email account to <strong>{question.email}</strong>. Replies go to the signed-in DOS account, <strong>{user.email}</strong>.</p>
                  <label htmlFor={`question-reply-${question.id}`}>Email reply to {question.name}</label>
                  <textarea id={`question-reply-${question.id}`} name="reply" rows={4} maxLength={3000} required placeholder="Write your response…" />
                  {emailFallback?.questionId === question.id && <p className="contact-email-fallback" role="alert">Automatic sending failed. Your reply is still here; open your email app and send it manually to {emailFallback.recipient}. Choose the DOS account as the sender.
                    {' '}<a href={emailFallback.href}>Open email app</a>
                  </p>}
                  <button className="button button-primary" type="submit" disabled={busyQuestion !== null}>
                    <Send size={14} /> {busyQuestion === question.id ? 'Sending…' : 'Send email reply'}
                  </button>
                </form>
              </article>)}
            </div> : <p className="panel-hint">No user questions have been submitted.</p>}
          </section> : studentSection === 'marks' ? <MarksReportsPanel initialAcademicYear={dashboard?.academicYear ?? ''} /> : <TimetableManager initialAcademicYear={dashboard?.academicYear ?? ''} teachers={dashboard?.teachers ?? []} />}
        </div>

        <div className="dashboard-columns">
          <section className="dashboard-panel" aria-labelledby="tasks-heading">
            <div className="panel-heading">
              <div><p className="section-label">Planning</p><h2 id="tasks-heading">Academic tasks &amp; deadlines</h2></div>
              <CalendarDays size={20} />
            </div>
            <p className="panel-hint">Personal website checklist only; this does not verify marks or reports in CAMIS or SDMS. Deadlines are not configured yet.</p>
            <ul className="task-list">
              {dashboard?.tasks.map((task) => (
                <li key={task.key}>
                  <label className={task.completedAt ? 'task-row is-complete' : 'task-row'}>
                    <input
                      type="checkbox"
                      checked={Boolean(task.completedAt)}
                      disabled={busyTask !== null}
                      onChange={() => void updateTask(task)}
                      aria-label={`${task.completedAt ? 'Reopen' : 'Mark complete'}: ${task.title}`}
                    />
                    <span className="task-check"><Check size={14} /></span>
                    <span className="task-copy"><strong>{task.title}</strong><small>{task.deadline ? `Deadline: ${task.deadline}` : 'Deadline not configured'}</small></span>
                    {busyTask === task.key && <span className="task-saving">Saving…</span>}
                  </label>
                </li>
              ))}
            </ul>
          </section>

          <section className="dashboard-panel workflow-panel" aria-labelledby="workflow-heading">
            <div className="panel-heading">
              <div><p className="section-label">Marks &amp; reports</p><h2 id="workflow-heading">Your workflow</h2></div>
              <FileText size={20} />
            </div>
            <ol className="workflow-list">
              <li><span>01</span><p>Sign in to this website with your authorized school account.</p></li>
              <li><span>02</span><p>Open this Academic Management dashboard.</p></li>
              <li><span>03</span><p>Open CAMIS for assigned assessment marks and report-card work.</p></li>
              <li><span>04</span><p>Open SDMS for school data or examination services assigned to you.</p></li>
              <li><span>05</span><p>Complete work inside the official system using your own authorized access.</p></li>
              <li><span>06</span><p>Import SDMS-exported CSV marks for your approved subjects. This website does not connect directly to SDMS.</p></li>
            </ol>
          </section>
        </div>

        <div className="dashboard-columns lower-panels">
          <section className="dashboard-panel activity-panel" aria-labelledby="activity-heading">
            <div className="panel-heading">
              <div><p className="section-label">This account</p><h2 id="activity-heading">Recent activity</h2></div>
              <ArrowDownRight size={20} />
            </div>
            {!dashboard?.activity.length ? (
              <div className="empty-activity"><CheckCircle2 size={20} /><p>No activity has been recorded for this account yet.</p></div>
            ) : (
              <ul className="activity-list">
                {dashboard.activity.map((item) => (
                  <li key={item.id}><span className="activity-dot"></span><div><p>{item.text}</p><time dateTime={item.at}>{new Date(item.at).toLocaleString()}</time></div></li>
                ))}
              </ul>
            )}
          </section>
          <PasswordChangeForm />
        </div>

        {user.role === 'administrator' && <AnnouncementManager />}

        {user.role === 'administrator' && (
          <div className="admin-link-row">
            <Link className="text-link" to="/admin/staff">Manage authorized staff accounts <ArrowUpRight size={16} /></Link>
          </div>
        )}
        <button className="sign-out-button" type="button" onClick={() => void signOut()}><LogOut size={15} /> Sign out</button>
        <p className="external-warning">CAMIS and SDMS are independent external government platforms. No API, single sign-on, credential transfer, or data sync is configured here.</p>
      </div>
    </section>
  )
}

function MarksReportsPanel({ initialAcademicYear }: { initialAcademicYear: string }) {
  const initialYear = initialAcademicYear || String(new Date().getFullYear())
  const [academicYear, setAcademicYear] = useState(initialYear)
  const [term, setTerm] = useState('Term 1')
  const [marks, setMarks] = useState<TeacherMark[]>([])
  const [studentNumber, setStudentNumber] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function loadMarks(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    setLoading(true)
    setError('')
    try {
      const result = await requestJson<{ marks: TeacherMark[]; truncated: boolean }>(`/api/dos/marks?academicYear=${encodeURIComponent(academicYear)}&term=${encodeURIComponent(term)}`)
      setMarks(result.marks)
      setStudentNumber((current) => result.marks.some((mark) => mark.studentNumber === current) ? current : result.marks[0]?.studentNumber ?? '')
      if (result.truncated) setError('Only the first 10,000 results are shown. Narrow the report or contact the administrator.')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Imported marks could not be loaded.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    requestJson<{ marks: TeacherMark[]; truncated: boolean }>(`/api/dos/marks?academicYear=${encodeURIComponent(initialYear)}&term=Term%201`)
      .then((result) => {
        if (!active) return
        setMarks(result.marks)
        setStudentNumber(result.marks[0]?.studentNumber ?? '')
        if (result.truncated) setError('Only the first 10,000 results are shown. Narrow the report or contact the administrator.')
      })
      .catch((requestError: unknown) => {
        if (active) setError(requestError instanceof Error ? requestError.message : 'Imported marks could not be loaded.')
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [initialYear])

  const students = [...new Map(marks.map((mark) => [mark.studentNumber, mark])).values()]
  const reportMarks = marks.filter((mark) => mark.studentNumber === studentNumber)
  const reportStudent = reportMarks[0]

  return (
    <section className="dashboard-panel marks-reports-panel" id="marks-reports-panel" role="tabpanel" aria-labelledby="marks-reports-tab">
      <div className="panel-heading"><div><p className="section-label">SDMS export reports</p><h2>End-of-term student report</h2></div><FileText size={20} /></div>
      <p className="panel-hint">Reports show SDMS-provided marks, calculated grades, and grade points. This website does not apply a separate grading scale.</p>
      <form className="report-filter-form" onSubmit={(event) => void loadMarks(event)}>
        <label>Academic year<input value={academicYear} maxLength={20} required onChange={(event) => setAcademicYear(event.target.value)} /></label>
        <label>Term<select value={term} onChange={(event) => setTerm(event.target.value)}><option>Term 1</option><option>Term 2</option><option>Term 3</option></select></label>
        <button className="button button-primary" type="submit" disabled={loading}>{loading ? 'Loading…' : 'View reports'}</button>
      </form>
      {error && <p className="portal-error" role="alert">{error}</p>}
      {marks.length > 0 && <label className="report-student-picker">Student report<select value={studentNumber} onChange={(event) => setStudentNumber(event.target.value)}>
        {students.map((mark) => <option key={mark.studentNumber} value={mark.studentNumber}>{mark.studentName} · {mark.studentNumber}</option>)}
      </select></label>}
      {reportMarks.length > 0 && reportStudent ? <div className="report-print-area">
        <div className="report-print-heading">
          <div><p className="section-label">{reportStudent.academicYear} · {reportStudent.term}</p><h3>End-of-term report</h3><p><strong>{reportStudent.studentName}</strong> · SDMS no. {reportStudent.studentNumber} · {reportStudent.classGrade || 'SDMS class not provided'}</p></div>
          <button className="button button-secondary report-print-button" type="button" onClick={() => window.print()}><Printer size={15} /> Print report</button>
        </div>
        <div className="student-table-wrap"><table className="student-table"><thead><tr><th>Subject</th><th>Assessment</th><th>Marks</th><th>Calculated grade</th><th>Grade points</th><th>Remarks</th></tr></thead><tbody>
          {reportMarks.map((mark) => <tr key={mark.id}><td>{mark.subjectName}</td><td>{mark.assessmentType}<br /><small>{mark.assessmentName}</small></td><td>{mark.marksObtained} / {mark.maxMarks}</td><td>{mark.calculatedGrade || '—'}</td><td>{mark.gradePoints ?? '—'}</td><td>{mark.remarks || '—'}</td></tr>)}
        </tbody></table></div>
      </div> : !loading && <p className="panel-hint">{marks.length ? 'Choose a student to view their report.' : 'No marks are available for this academic year and term. Import SDMS CSV exports first.'}</p>}
    </section>
  )
}

function TimetableManager({ initialAcademicYear, teachers }: { initialAcademicYear: string; teachers: TeacherMember[] }) {
  const initialYear = initialAcademicYear || String(new Date().getFullYear())
  const [academicYear, setAcademicYear] = useState(initialYear)
  const [loadedYear, setLoadedYear] = useState(initialYear)
  const [assignments, setAssignments] = useState<TeachingAssignment[]>([])
  const [timetable, setTimetable] = useState<TimetableSlot[]>([])
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [gradeFilter, setGradeFilter] = useState('all')
  const [teacherId, setTeacherId] = useState(teachers[0]?.id ?? '')
  const [grade, setGrade] = useState('Primary 1')
  const [subject, setSubject] = useState('')
  const [periodsPerWeek, setPeriodsPerWeek] = useState('1')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const currentTeacher = teachers.find((teacher) => teacher.id === teacherId)
  const availableSubjects = currentTeacher?.assignedCourses ?? []
  const selectedSubject = availableSubjects.includes(subject) ? subject : availableSubjects[0] ?? ''
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
  const times = ['08:30–09:10', '09:10–09:50', '10:20–11:00', '11:00–11:40', '12:40–13:20', '13:20–14:00', '14:10–14:50', '14:50–15:30']

  async function loadTimetable() {
    setLoading(true)
    setError('')
    try {
      const result = await requestJson<{ assignments: TeachingAssignment[]; timetable: TimetableSlot[]; generatedAt: string | null }>(`/api/dos/timetable?academicYear=${encodeURIComponent(academicYear)}`)
      setAssignments(result.assignments)
      setTimetable(result.timetable)
      setGeneratedAt(result.generatedAt)
      setLoadedYear(academicYear)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The timetable could not be loaded.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    requestJson<{ assignments: TeachingAssignment[]; timetable: TimetableSlot[]; generatedAt: string | null }>(`/api/dos/timetable?academicYear=${encodeURIComponent(initialYear)}`)
      .then((result) => {
        if (!active) return
        setAssignments(result.assignments)
        setTimetable(result.timetable)
        setGeneratedAt(result.generatedAt)
      })
      .catch((requestError: unknown) => {
        if (active) setError(requestError instanceof Error ? requestError.message : 'The timetable could not be loaded.')
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [initialYear])

  async function addAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!teacherId || !selectedSubject) {
      setError('Choose an approved teacher and one of their assigned subjects.')
      return
    }
    const existingIndex = assignments.findIndex((item) => item.teacherId === teacherId && item.grade === grade && item.subject === selectedSubject)
    const updated = [...assignments]
    const assignment: TeachingAssignment = {
      id: existingIndex >= 0 ? assignments[existingIndex].id : `new-${teacherId}-${grade}-${selectedSubject}`,
      teacherId,
      teacherEmail: currentTeacher?.email ?? '',
      grade,
      subject: selectedSubject,
      periodsPerWeek: Number(periodsPerWeek),
    }
    if (existingIndex >= 0) updated[existingIndex] = assignment
    else updated.push(assignment)
    setAssignments(updated)
    setMessage('')
    setError('')
  }

  async function saveAssignments() {
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const result = await requestJson<{ message: string; assignments: TeachingAssignment[] }>('/api/dos/timetable/assignments', {
        method: 'PUT',
        body: JSON.stringify({
          academicYear,
          assignments: assignments.map(({ teacherId: id, grade: classGrade, subject: course, periodsPerWeek: periods }) => ({
            teacherId: id,
            grade: classGrade,
            subject: course,
            periodsPerWeek: periods,
          })),
        }),
      })
      setAssignments(result.assignments)
      setTimetable([])
      setGeneratedAt(null)
      setMessage(result.message)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Teaching assignments could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  async function generate() {
    setGenerating(true)
    setError('')
    setMessage('')
    try {
      const result = await requestJson<{ message: string; generatedAt: string; timetable: TimetableSlot[] }>('/api/dos/timetable/generate', {
        method: 'POST',
        body: JSON.stringify({ academicYear }),
      })
      setTimetable(result.timetable)
      setGeneratedAt(result.generatedAt)
      setMessage(result.message)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'A timetable could not be generated.')
    } finally {
      setGenerating(false)
    }
  }

  function removeAssignment(id: string) {
    setAssignments((current) => current.filter((assignment) => assignment.id !== id))
    setTimetable([])
    setGeneratedAt(null)
  }

  const scheduledGrades = [...new Set(timetable.map((slot) => slot.grade))]

  return (
    <section className="dashboard-panel timetable-panel" id="timetable-panel" role="tabpanel" aria-labelledby="timetable-tab">
      <div className="panel-heading"><div><p className="section-label">Weekly periods and generated schedule</p><h2>Class &amp; teacher timetables</h2></div><CalendarDays size={20} /></div>
      <p className="panel-hint">Assign weekly subject loads to approved teachers. Generation prevents a teacher or class from being booked twice in the same period.</p>
      <div className="timetable-year-row"><label>Academic year<input value={academicYear} maxLength={20} required onChange={(event) => setAcademicYear(event.target.value)} /></label><button className="button button-secondary" type="button" onClick={() => void loadTimetable()} disabled={loading}>{loading ? 'Loading…' : 'Load year'}</button></div>
      <form className="assignment-entry-form" onSubmit={(event) => void addAssignment(event)}>
        <label>Approved teacher<select value={teacherId} onChange={(event) => setTeacherId(event.target.value)} required><option value="">Select teacher</option>{teachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.email}</option>)}</select></label>
        <label>Class<select value={grade} onChange={(event) => setGrade(event.target.value)}>{['Nursery 1', 'Nursery 2', 'Nursery 3', 'Primary 1', 'Primary 2', 'Primary 3', 'Primary 4'].map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>Approved subject<select value={selectedSubject} onChange={(event) => setSubject(event.target.value)} required><option value="">Select subject</option>{availableSubjects.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>Periods per week<input type="number" min="1" max="40" required value={periodsPerWeek} onChange={(event) => setPeriodsPerWeek(event.target.value)} /></label>
        <button className="button button-primary" type="submit" disabled={!teachers.length}><Plus size={15} /> Add / update load</button>
      </form>
      {error && <p className="portal-error" role="alert">{error}</p>}
      {message && <p className="portal-success" role="status">{message}</p>}
      {assignments.length ? <div className="student-table-wrap"><table className="student-table"><thead><tr><th>Teacher</th><th>Class</th><th>Subject</th><th>Periods / week</th><th></th></tr></thead><tbody>
        {assignments.map((assignment) => <tr key={assignment.id}><td>{assignment.teacherEmail || teachers.find((item) => item.id === assignment.teacherId)?.email || 'Teacher unavailable'}</td><td>{assignment.grade}</td><td>{assignment.subject}</td><td>{assignment.periodsPerWeek}</td><td><button className="staff-status-button" type="button" onClick={() => void removeAssignment(assignment.id)} aria-label={`Remove ${assignment.subject} assignment for ${assignment.grade}`}><Trash2 size={15} /> Remove</button></td></tr>)}
      </tbody></table></div> : <p className="panel-hint">No weekly teaching assignments are configured for this year.</p>}
      <div className="timetable-actions"><button className="button button-primary" type="button" onClick={() => void saveAssignments()} disabled={saving || loading || loadedYear !== academicYear}>{saving ? 'Saving…' : 'Save weekly loads'}</button><button className="button button-secondary" type="button" onClick={() => void generate()} disabled={generating || saving || assignments.length === 0 || loadedYear !== academicYear}>{generating ? 'Generating…' : 'Generate clash-free timetable'}</button></div>
      <p className="panel-hint">Eight 40-minute periods run 08:30–15:30. Break: 10:00–10:20; lunch: 11:40–12:40; transitions: 09:50–10:00 and 14:00–14:10. Sports/clubs run Monday–Thursday, 15:30–17:00; Friday has no after-school block.</p>
      {timetable.length > 0 && <section className="generated-timetable">
        <div className="panel-heading"><div><p className="section-label">Generated {generatedAt ? new Date(generatedAt).toLocaleString() : ''}</p><h3>Weekly class timetable</h3></div></div>
          <label className="report-student-picker">Class<select value={gradeFilter} onChange={(event) => setGradeFilter(event.target.value)}><option value="all">All classes</option>{scheduledGrades.map((item) => <option key={item}>{item}</option>)}</select></label>
        <div className="student-table-wrap timetable-grid-wrap"><table className="student-table timetable-grid"><thead><tr><th>Day</th>{times.map((time, index) => <th key={time}>Period {index + 1}<br /><small>{time}</small></th>)}</tr></thead><tbody>{days.map((day) => <tr key={day}><th>{day}</th>{times.map((_time, index) => <td key={`${day}-${index}`}>{timetable.filter((slot) => slot.day === day && slot.period === index + 1 && (gradeFilter === 'all' || slot.grade === gradeFilter)).map((slot) => <div className="timetable-cell-entry" key={`${slot.grade}-${slot.teacherId}`}><strong>{slot.grade}: {slot.subject}</strong><small>{slot.teacherEmail}</small></div>)}</td>)}</tr>)}</tbody></table></div>
      </section>}
    </section>
  )
}

function PlatformAccessSection() {
  return (
    <>
      <div className="portal-section-heading">
        <div><p className="section-label">Official external platforms</p><h2>Quick access</h2></div>
        <span className="external-note"><ExternalLink size={14} /> Government systems open in a new tab</span>
      </div>
      <div className="platform-grid">
        {platforms.map(({ title, fullTitle, description, url, icon: Icon }) => (
          <article className="platform-card" key={title}>
            <span className="platform-icon"><Icon size={22} /></span>
            <p className="platform-acronym">{title}</p>
            <h3>{fullTitle}</h3>
            <p className="platform-description">{description}</p>
            <p className="external-disclosure"><ExternalLink size={13} /> External government system — sign in there with your official account.</p>
            <a className="button button-primary platform-button" href={url} target="_blank" rel="noopener noreferrer">
              Open {title} <ExternalLink size={15} aria-hidden="true" />
              <span className="visually-hidden">(opens in a new tab)</span>
            </a>
          </article>
        ))}
      </div>
    </>
  )
}

function GmailConnectionPanel() {
  const [status, setStatus] = useState<GmailConnectionStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const location = useLocation()
  const gmailResult = new URLSearchParams(location.search).get('gmail')
  const connectionError = gmailResult === 'cancelled'
    ? 'Gmail connection was cancelled.'
    : gmailResult === 'not-configured'
      ? 'Gmail OAuth settings are missing or invalid on the server.'
      : gmailResult && gmailResult !== 'connected'
        ? 'Gmail could not be connected. Check the Google OAuth settings and try again.'
        : ''

  async function loadStatus() {
    const result = await requestJson<GmailConnectionStatus>('/api/dos/gmail/status')
    setStatus(result)
  }

  useEffect(() => {
    let active = true
    requestJson<GmailConnectionStatus>('/api/dos/gmail/status')
      .then((result) => { if (active) setStatus(result) })
      .catch((statusError: unknown) => { if (active) setError(statusError instanceof Error ? statusError.message : 'Gmail connection status could not be loaded.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  async function disconnect() {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await requestNoContent('/api/dos/gmail/connection', { method: 'DELETE' })
      await loadStatus()
      setMessage('The school Gmail account has been disconnected.')
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : 'Gmail could not be disconnected.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="gmail-connection-panel" aria-label="School email connection">
      <div>
        <strong>School email</strong>
        {loading ? <p>Checking school email…</p> : status?.connected
          ? <p>Gmail is connected: <strong>{status.email}</strong>. Automatic acknowledgments and replies use this mailbox.</p>
          : <p>Connect the DOS Gmail account to send automatic acknowledgments and replies. SMTP is not used for school correspondence.</p>}
        {status?.connectionError && <p className="gmail-setup-hint">{status.connectionError}</p>}
        {status && !status.configured && <p className="gmail-setup-hint">Server setup required: {status.missingSettings.join(', ')}. Configure these values and restart the API.</p>}
        {error && <p className="portal-error" role="alert">{error}</p>}
        {message && <p className="portal-success" role="status">{message}</p>}
        {gmailResult === 'connected' && <p className="portal-success" role="status">Gmail is connected. Automatic confirmations and DOS replies will use this mailbox.</p>}
        {connectionError && <p className="portal-error" role="alert">{connectionError}</p>}
      </div>
      {status?.connected
        ? <button className="gmail-connect-button" type="button" disabled={busy} onClick={() => void disconnect()}>{busy ? 'Disconnecting…' : 'Disconnect Gmail'}</button>
        : status?.configured && <a className="gmail-connect-button" href="/api/dos/gmail/connect">Connect Gmail with Google</a>}
    </section>
  )
}

function TeacherProfileCard({ onSaved, onNameChange }: { onSaved?: () => Promise<void>; onNameChange?: (name: string) => void }) {
  const [profile, setProfile] = useState<TeacherProfile | null>(null)
  const [marks, setMarks] = useState<TeacherMark[]>([])
  const [marksTruncated, setMarksTruncated] = useState(false)
  const [timetable, setTimetable] = useState<Array<Pick<TimetableSlot, 'day' | 'period' | 'startsAt' | 'endsAt' | 'grade' | 'subject'>>>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [csv, setCsv] = useState('')
  const [csvFileName, setCsvFileName] = useState('')
  const [importSummary, setImportSummary] = useState<{ imported: number; updated: number; unmatched: number; invalid: number; unmatchedRows: Array<{ row: number; studentNumber: string; reason: string }>; invalidRows: Array<{ row: number; reason: string }> } | null>(null)

  useEffect(() => {
    let active = true
    requestJson<TeacherDashboardData>('/api/teacher/dashboard')
      .then((result) => {
        if (!active) return
        setProfile(result.profile)
        onNameChange?.(result.profile.name)
        setMarks(result.marks)
        setMarksTruncated(result.marksTruncated)
        setTimetable(result.timetable)
      })
      .catch((requestError: unknown) => {
        if (active) setError(requestError instanceof Error ? requestError.message : 'Teacher profile could not be loaded.')
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [onNameChange])

  async function submitStudies(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const name = new FormData(form).get('name')
    const studies = new FormData(form).get('studies')
    if (typeof name !== 'string' || typeof studies !== 'string') return
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const result = await requestJson<{ profile: TeacherProfile; message: string }>('/api/teacher/profile', {
        method: 'PATCH',
        body: JSON.stringify({ name, studies }),
      })
      setProfile(result.profile)
      onNameChange?.(result.profile.name)
      setMessage(result.message)
      if (onSaved) await onSaved()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Studies could not be submitted.')
    } finally {
      setSaving(false)
    }
  }

  async function importMarks(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    if (!csv.trim()) {
      setError('Choose an SDMS CSV file before importing marks.')
      return
    }
    setImporting(true)
    setError('')
    setMessage('')
    setImportSummary(null)
    try {
      const result = await requestJson<typeof importSummary>('/api/teacher/marks/import', {
        method: 'POST',
        body: csv,
        headers: { 'Content-Type': 'text/csv; charset=utf-8' },
      })
      if (!result) throw new Error('The import did not return a result.')
      setImportSummary(result)
      const refreshed = await requestJson<TeacherDashboardData>('/api/teacher/dashboard')
      setProfile(refreshed.profile)
      setMarks(refreshed.marks)
      setMarksTruncated(refreshed.marksTruncated)
      setTimetable(refreshed.timetable)
      setMessage(`Import complete: ${result.imported} new, ${result.updated} updated, ${result.unmatched} unmatched, ${result.invalid} invalid.`)
      form.reset()
      setCsv('')
      setCsvFileName('')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The SDMS CSV could not be imported.')
    } finally {
      setImporting(false)
    }
  }

  async function chooseCsv(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) return
    setError('')
    if (file.size > 1_000_000) {
      input.value = ''
      setCsv('')
      setCsvFileName('')
      setError('Choose a CSV file no larger than 1 MB.')
      return
    }
    try {
      setCsv(await file.text())
      setCsvFileName(file.name)
      setImportSummary(null)
    } catch (readError) {
      input.value = ''
      setCsv('')
      setCsvFileName('')
      setError(readError instanceof Error ? readError.message : 'The selected CSV file could not be read.')
    }
  }

  return (
    <section className="dashboard-panel teacher-profile-panel" aria-labelledby="teacher-profile-heading">
      <div className="panel-heading"><div><p className="section-label">My dashboard</p><h2 id="teacher-profile-heading">Your teaching subjects</h2></div><BookOpenCheck size={20} /></div>
      {loading ? <p className="panel-hint">Loading your teacher profile…</p> : <>
        {error && <p className="portal-error" role="alert">{error}</p>}
        {message && <p className="portal-success" role="status">{message}</p>}
        <p className={profile?.approved ? 'teacher-membership-status is-approved' : 'teacher-membership-status'}>{profile?.approved ? 'Approved member of the Teachers group' : 'Pending DOS or administrator approval'}</p>
        <div className="teacher-own-courses"><h3>Subjects to teach</h3>{profile?.assignedCourses.length ? <ul>{profile.assignedCourses.map((course) => <li key={course}>{course}</li>)}</ul> : <p className="panel-hint">No subjects have been assigned to your account yet. Contact the Director of Studies.</p>}</div>
        <div className="teacher-profile-details">
          <h3>Teacher profile</h3>
        <form className="staff-form teacher-profile-form" onSubmit={(event) => void submitStudies(event)}>
          <label htmlFor="teacher-name">Your name<input id="teacher-name" name="name" type="text" maxLength={100} required defaultValue={profile?.name ?? ''} placeholder="Enter the name to display on your dashboard" /></label>
          <label htmlFor="teacher-studies">Studies or teaching qualifications<textarea id="teacher-studies" name="studies" rows={4} maxLength={500} required defaultValue={profile?.studies ?? ''} placeholder="Describe your studies, qualifications, and subject experience" /></label>
          <button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Submitting…' : 'Submit studies for review'}</button>
        </form>
        </div>
        <section className="teacher-marks-section">
          <div className="panel-heading"><div><p className="section-label">SDMS export</p><h2>Import assigned-subject marks</h2></div><Upload size={19} /></div>
          <p className="panel-hint">Select an SDMS marks CSV, then choose Import marks. Only registered students and your assigned subjects are imported. Maximum file size: 1 MB.</p>
          <p className="marks-csv-format">Required CSV headers: student number, student name, class/grade, subject code, subject name, assessment type, assessment name, marks obtained, max marks, term, academic year, calculated grade, grade points, remarks.</p>
          {!profile?.approved && <p className="teacher-import-notice">Import is available after the DOS or administrator approves your Teachers group membership and assigns your subjects.</p>}
          {profile?.approved && !profile.assignedCourses.length && <p className="teacher-import-notice">Ask the Director of Studies to assign at least one subject before importing marks.</p>}
          <form className="staff-form marks-import-form" onSubmit={(event) => void importMarks(event)}>
            <label htmlFor="sdms-marks-file">SDMS marks CSV<input id="sdms-marks-file" type="file" accept=".csv,text/csv" onChange={(event) => void chooseCsv(event)} /></label>
            {csvFileName && <p className="panel-hint">{csvFileName} · {csv.split(/\r\n|\r|\n/).length - 1} data rows ready to import.</p>}
            <button className="button button-primary marks-import-button" type="submit" disabled={importing || !csv || !profile?.approved || !profile.assignedCourses.length}>
              <Upload size={15} /> {importing ? 'Importing…' : 'Import marks'}
            </button>
          </form>
          {importSummary && <div className="import-summary" role="status">
            <strong>New: {importSummary.imported} · Updated: {importSummary.updated} · Unmatched: {importSummary.unmatched} · Invalid: {importSummary.invalid}</strong>
            {[...importSummary.unmatchedRows.map((row) => ({ ...row, kind: 'Unmatched' })), ...importSummary.invalidRows.map((row) => ({ ...row, kind: 'Invalid' }))].slice(0, 20).map((row, index) => <p key={`${row.kind}-${row.row}-${index}`}>Row {row.row} · {row.kind}: {'studentNumber' in row ? `${row.studentNumber} · ` : ''}{row.reason}</p>)}
          </div>}
        </section>
        {profile?.approved && <>
          <section className="teacher-marks-section">
            <div className="panel-heading"><div><p className="section-label">Authorized results</p><h2>Assigned-subject marks</h2></div><FileText size={19} /></div>
            {marksTruncated && <p className="panel-hint">Showing the latest 1,000 assigned-subject results. Use the DOS report for a specific academic year and term.</p>}
            {marks.length ? <div className="student-table-wrap"><table className="student-table"><thead><tr><th>Student / SDMS no.</th><th>SDMS class</th><th>Subject / assessment</th><th>Marks</th><th>SDMS grade</th><th>Points</th><th>Term / year</th></tr></thead><tbody>
              {marks.map((mark) => <tr key={mark.id}><td>{mark.studentName}<br /><small>{mark.studentNumber}</small></td><td>{mark.classGrade || '—'}</td><td>{mark.subjectName}<br /><small>{mark.assessmentType}: {mark.assessmentName}</small></td><td>{mark.marksObtained} / {mark.maxMarks}</td><td>{mark.calculatedGrade || '—'}</td><td>{mark.gradePoints ?? '—'}</td><td>{mark.term}<br />{mark.academicYear}</td></tr>)}
            </tbody></table></div> : <p className="panel-hint">No marks are available for your approved subjects yet.</p>}
          </section>
          <section className="teacher-marks-section teacher-own-timetable">
            <div className="panel-heading"><div><p className="section-label">Generated by DOS</p><h2>Your teaching timetable</h2></div><CalendarDays size={19} /></div>
            {timetable.length ? <div className="student-table-wrap"><table className="student-table"><thead><tr><th>Day</th><th>Period</th><th>Time</th><th>Class</th><th>Subject</th></tr></thead><tbody>
              {timetable.map((slot, index) => <tr key={`${slot.day}-${slot.period}-${index}`}><td>{slot.day}</td><td>{slot.period}</td><td>{slot.startsAt}–{slot.endsAt}</td><td>{slot.grade}</td><td>{slot.subject}</td></tr>)}
            </tbody></table></div> : <p className="panel-hint">The DOS has not generated a timetable with your assignments yet.</p>}
            <p className="panel-hint">The school day has 40-minute periods. Morning break is 10:00–10:20, lunch is 11:40–12:40, and transitions are 9:50–10:00 and 14:00–14:10.</p>
          </section>
        </>}
      </>}
    </section>
  )
}

type ManagedAnnouncement = { id: string; title: string; body: string; published: boolean; createdAt: string }

function AnnouncementManager() {
  const [announcements, setAnnouncements] = useState<ManagedAnnouncement[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function loadAnnouncements() {
    const result = await requestJson<{ announcements: ManagedAnnouncement[] }>('/api/announcements/manage')
    setAnnouncements(result.announcements)
  }

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const result = await requestJson<{ announcements: ManagedAnnouncement[] }>('/api/announcements/manage')
        if (active) setAnnouncements(result.announcements)
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Announcements could not be loaded.')
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => { active = false }
  }, [])

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    setError('')
    setMessage('')
    setSaving(true)
    try {
      await requestJson('/api/announcements', {
        method: 'POST',
        body: JSON.stringify({ title: values.get('title'), body: values.get('body') }),
      })
      form.reset()
      await loadAnnouncements()
      setMessage('Announcement published for the school community.')
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : 'Announcement could not be published.')
    } finally {
      setSaving(false)
    }
  }

  async function setPublished(announcement: ManagedAnnouncement) {
    setError('')
    setMessage('')
    try {
      await requestJson(`/api/announcements/${announcement.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ published: !announcement.published }),
      })
      await loadAnnouncements()
      setMessage(announcement.published ? 'Announcement unpublished.' : 'Announcement published.')
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Announcement could not be updated.')
    }
  }

  return (
    <section className="dashboard-panel announcement-manager" aria-labelledby="announcements-manager-heading">
      <div className="panel-heading">
        <div><p className="section-label">School community</p><h2 id="announcements-manager-heading">Announcements</h2></div>
        <Bell size={20} />
      </div>
      <p className="panel-hint">Published announcements appear on the public school website. Accountants’ family notices are included in the same feed.</p>
      <form className="staff-form announcement-form" onSubmit={(event) => void publish(event)}>
        <label>Title<input name="title" required maxLength={120} /></label>
        <label>Message<textarea name="body" rows={4} required maxLength={1500} /></label>
        {error && <p className="portal-error" role="alert">{error}</p>}
        {message && <p className="portal-success" role="status">{message}</p>}
        <button className="button button-primary" disabled={saving}>{saving ? 'Publishing…' : 'Publish announcement'} <Send size={15} /></button>
      </form>
      <div className="managed-announcements">
        <h3>Recent announcements</h3>
        {loading ? <p className="panel-hint">Loading announcements…</p> : announcements.length === 0 ? <p className="panel-hint">No announcements have been created yet.</p> : announcements.map((announcement) => (
          <article className="managed-announcement" key={announcement.id}>
            <div><strong>{announcement.title}</strong><time>{new Date(announcement.createdAt).toLocaleDateString()}</time></div>
            <p>{announcement.body}</p>
            <button className="staff-status-button" type="button" onClick={() => void setPublished(announcement)}>{announcement.published ? 'Unpublish' : 'Publish'}</button>
          </article>
        ))}
      </div>
    </section>
  )
}

export function SignInPage() {
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const returnTo = typeof location.state === 'object' && location.state !== null && 'from' in location.state &&
    typeof location.state.from === 'string' && location.state.from.startsWith('/')
    ? location.state.from
    : '/academic-management'

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    const values = new FormData(event.currentTarget)
    try {
      await requestJson('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: values.get('email'), password: values.get('password') }),
      })
      navigate(returnTo, { replace: true })
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Sign in could not be completed.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="academic-page">
      <div className="auth-card">
        <span className="platform-icon"><LockKeyhole size={21} /></span>
        <p className="section-label">Authorized school staff</p>
        <h1>Sign in to your<br /><em>school account.</em></h1>
        <p className="auth-intro">Use the account provided by your school administrator. This form is only for the school website; never enter CAMIS or SDMS passwords here.</p>
        <form className="staff-form" onSubmit={(event) => void submit(event)}>
          <label>School email<input type="email" name="email" autoComplete="username" required maxLength={254} /></label>
          <label>Password<input type="password" name="password" autoComplete="current-password" required maxLength={256} /></label>
          {error && <p className="portal-error" role="alert">{error}</p>}
          <button className="button button-primary" disabled={submitting}>{submitting ? 'Signing in…' : 'Sign in securely'} <LockKeyhole size={15} /></button>
        </form>
        <Link className="forgot-password-link" to="/forgot-password">Forgot password?</Link>
      </div>
    </section>
  )
}

export function PasswordRecoveryPage() {
  const [email, setEmail] = useState('')
  const [step, setStep] = useState<'request' | 'verify' | 'complete'>('request')
  const [resendSeconds, setResendSeconds] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (resendSeconds === 0) return
    const timer = window.setTimeout(() => setResendSeconds((seconds) => seconds - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [resendSeconds])

  async function requestCode(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    setError('')
    setMessage('')
    setSubmitting(true)
    try {
      const result = await requestJson<{ message: string }>('/api/auth/password-recovery/request', {
        method: 'POST',
        body: JSON.stringify({ email }),
      })
      setMessage(result.message)
      setStep('verify')
      setResendSeconds(60)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The recovery request could not be completed.')
    } finally {
      setSubmitting(false)
    }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const newPassword = String(values.get('newPassword') ?? '')
    if (newPassword !== values.get('confirmPassword')) {
      setError('The new passwords do not match.')
      return
    }
    setError('')
    setMessage('')
    setSubmitting(true)
    try {
      const result = await requestJson<{ message: string }>('/api/auth/password-recovery/verify', {
        method: 'POST',
        body: JSON.stringify({ email, code: values.get('code'), newPassword }),
      })
      setMessage(result.message)
      setStep('complete')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The recovery code could not be verified.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="academic-page">
      <div className="auth-card recovery-card">
        <span className="platform-icon"><LockKeyhole size={21} /></span>
        <p className="section-label">Authorized school staff</p>
        <h1>Recover your<br /><em>school account.</em></h1>
        {step === 'request' && <>
          <p className="auth-intro">Enter the email address registered on your staff account. We’ll send the verification code to that address.</p>
          <form className="staff-form" onSubmit={(event) => void requestCode(event)}>
            <label>School email<input type="email" name="email" autoComplete="username" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            {error && <p className="portal-error" role="alert">{error}</p>}
            <button className="button button-primary" disabled={submitting}>{submitting ? 'Sending code…' : 'Send verification code'}</button>
          </form>
        </>}
        {step === 'verify' && <>
          <p className="auth-intro">Enter the 8-digit code sent to <strong>{email}</strong> and choose a new password.</p>
          {message && <p className="recovery-message" role="status">{message}</p>}
          <form className="staff-form" onSubmit={(event) => void verifyCode(event)}>
            <label>Verification code<input name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{8}" minLength={8} maxLength={8} required /></label>
            <label>New password<input name="newPassword" type="password" autoComplete="new-password" minLength={12} maxLength={256} required /></label>
            <label>Confirm new password<input name="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={256} required /></label>
            {error && <p className="portal-error" role="alert">{error}</p>}
            <button className="button button-primary" disabled={submitting}>{submitting ? 'Verifying…' : 'Reset password'}</button>
          </form>
          <button className="recovery-resend" type="button" disabled={submitting || resendSeconds > 0} onClick={() => void requestCode()}>
            {resendSeconds > 0 ? `Send another code in ${resendSeconds}s` : 'Send another code'}
          </button>
          <button className="recovery-resend" type="button" onClick={() => { setStep('request'); setMessage(''); setError('') }}>Use a different email</button>
        </>}
        {step === 'complete' && <>
          <p className="recovery-message" role="status">{message}</p>
          <Link className="button button-primary recovery-sign-in" to="/sign-in">Return to sign in</Link>
        </>}
        {step !== 'complete' && <Link className="forgot-password-link" to="/sign-in">Back to sign in</Link>}
      </div>
    </section>
  )
}

export function AdminStaffPage() {
  const [user, setUser] = useState<SchoolUser | null>(null)
  const [staff, setStaff] = useState<SchoolUser[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [deletingStaff, setDeletingStaff] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function loadStaff() {
    const result = await requestJson<{ users: SchoolUser[] }>('/api/admin/users')
    setStaff(result.users)
  }

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const session = await requestJson<{ user: SchoolUser }>('/api/auth/session')
        if (!active) return
        setUser(session.user)
        if (session.user.role === 'administrator') {
          const result = await requestJson<{ users: SchoolUser[] }>('/api/admin/users')
          if (active) setStaff(result.users)
        }
      } catch (requestError) {
        if (active) setError(requestError instanceof Error ? requestError.message : 'Staff accounts could not be loaded.')
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => { active = false }
  }, [])

  async function createStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    setError('')
    setSuccess('')
    setSubmitting(true)
    try {
      const result = await requestJson<{ emailConfirmation: { sent: boolean; message: string } }>('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          email: values.get('email'),
          password: values.get('password'),
          role: values.get('role'),
        }),
      })
      form.reset()
      setSuccess(`Staff account created. ${result.emailConfirmation.message}`)
      await loadStaff()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Staff account could not be created.')
    } finally {
      setSubmitting(false)
    }
  }

  async function updateStaff(member: SchoolUser, update: { active?: boolean; role?: Role }) {
    setError('')
    setSuccess('')
    try {
      await requestJson(`/api/admin/users/${member.id}`, { method: 'PATCH', body: JSON.stringify(update) })
      setSuccess('Staff account updated.')
      await loadStaff()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Staff account could not be updated.')
    }
  }

  async function deleteStaff(member: SchoolUser) {
    if (member.active || !window.confirm(`Permanently delete the disabled account for ${member.email}?`)) return
    setError('')
    setSuccess('')
    setDeletingStaff(member.id)
    try {
      await requestNoContent(`/api/admin/users/${member.id}`, { method: 'DELETE' })
      setSuccess('Disabled staff account deleted.')
      await loadStaff()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Staff account could not be deleted.')
    } finally {
      setDeletingStaff(null)
    }
  }

  if (loading) return <StatusPanel title="Loading staff accounts…" detail="Checking administrator access." />
  if (!user || user.role !== 'administrator') {
    return <StatusPanel title="Administrator access required" detail={error || 'Only an administrator can manage staff accounts.'} action={<Link className="button button-primary" to="/sign-in" state={{ from: '/admin/staff' }}>Sign in</Link>} />
  }

  return (
    <section className="academic-page">
      <div className="staff-admin-shell">
        <p className="section-label">Administrator</p>
        <h1>Authorized <em>staff accounts.</em></h1>
        <p className="dashboard-intro">Create and manage access for school website accounts. Roles control server-side access; never use government-platform passwords here.</p>
        <Link className="text-link back-link" to="/academic-management">← Return to Academic Management</Link>
        {error && <p className="portal-error" role="alert">{error}</p>}
        {success && <p className="portal-success" role="status">{success}</p>}
        <div className="dashboard-columns staff-admin-grid">
          <form className="dashboard-panel staff-form" onSubmit={(event) => void createStaff(event)}>
            <h2>Create a staff account</h2>
            <label>School email<input name="email" type="email" autoComplete="off" required maxLength={254} /></label>
            <label>Initial password<input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={256} /></label>
            <label>Role<select name="role" defaultValue="dos"><option value="administrator">Administrator</option><option value="dos">Director of Studies (DOS)</option><option value="teacher">Teacher</option><option value="dos_teacher">Director of Studies &amp; Teacher (one login)</option><option value="accountant">Accountant</option></select></label>
            <p className="panel-hint">Use a unique password with at least 12 characters. Provide it securely to the staff member and ask them to change it after signing in.</p>
            <button className="button button-primary" disabled={submitting}>{submitting ? 'Creating…' : 'Create account'}</button>
          </form>
          <section className="dashboard-panel staff-list-panel" aria-labelledby="staff-list-heading">
            <h2 id="staff-list-heading">School staff</h2>
            {staff.length === 0 ? <p className="panel-hint">No staff accounts are available.</p> : (
              <ul className="staff-list">
                {staff.map((member) => (
                  <li key={member.id}>
                    <div><strong>{member.email}</strong><small>{roleName(member.role)} · {member.active ? 'Active' : 'Disabled'}</small></div>
                    <div className="staff-controls">
                      <label className="visually-hidden" htmlFor={`role-${member.id}`}>Role for {member.email}</label>
                      <select id={`role-${member.id}`} value={member.role} disabled={member.id === user.id} onChange={(event) => void updateStaff(member, { role: event.target.value as Role })}>
                        <option value="administrator">Administrator</option><option value="dos">DOS</option><option value="teacher">Teacher</option><option value="dos_teacher">DOS &amp; Teacher (one login)</option><option value="accountant">Accountant</option>
                      </select>
                      <button className="staff-status-button" type="button" disabled={member.id === user.id} onClick={() => void updateStaff(member, { active: !member.active })}>
                        {member.active ? 'Disable' : 'Enable'}
                      </button>
                      {!member.active && <button className="staff-delete-button" type="button" disabled={deletingStaff !== null} onClick={() => void deleteStaff(member)}><Trash2 size={13} />{deletingStaff === member.id ? 'Deleting…' : 'Delete'}</button>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </section>
  )
}

function PasswordChangeForm() {
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    setMessage('')
    setError('')
    setSaving(true)
    try {
      await requestJson('/api/auth/password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: values.get('currentPassword'),
          newPassword: values.get('newPassword'),
        }),
      })
      form.reset()
      setMessage('Password updated. Other active sessions have been signed out.')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Password could not be changed.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="dashboard-panel password-panel" aria-labelledby="password-heading">
      <div className="panel-heading"><div><p className="section-label">Account security</p><h2 id="password-heading">Change password</h2></div><LockKeyhole size={20} /></div>
      <form className="staff-form" onSubmit={(event) => void submit(event)}>
        <label>Current password<input name="currentPassword" type="password" autoComplete="current-password" required maxLength={256} /></label>
        <label>New password<input name="newPassword" type="password" autoComplete="new-password" required minLength={12} maxLength={256} /></label>
        <p className="panel-hint">Choose at least 12 characters. Changing your password signs out other sessions.</p>
        {error && <p className="portal-error" role="alert">{error}</p>}
        {message && <p className="portal-success" role="status">{message}</p>}
        <button className="button button-dark" disabled={saving}>{saving ? 'Saving…' : 'Update password'}</button>
      </form>
    </section>
  )
}

function StatusPanel({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return (
    <section className="academic-page">
      <div className="auth-card status-card">
        <span className="platform-icon"><ShieldCheck size={21} /></span>
        <h1>{title}</h1><p className="auth-intro">{detail}</p>
        {action}
      </div>
    </section>
  )
}
