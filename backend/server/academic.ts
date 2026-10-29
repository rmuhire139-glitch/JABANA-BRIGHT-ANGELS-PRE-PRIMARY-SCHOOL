export interface ImportedMark {
  rowNumber: number
  studentNumber: string
  studentName: string
  classGrade: string
  subjectCode: string
  subjectName: string
  assessmentType: string
  assessmentName: string
  marksObtained: number
  maxMarks: number
  term: string
  academicYear: string
  calculatedGrade: string
  gradePoints: number | null
  remarks: string
}

export interface InvalidMarkRow {
  row: number
  reason: string
}

export interface ParsedMarksCsv {
  marks: ImportedMark[]
  invalidRows: InvalidMarkRow[]
}

const markHeaders = [
  'student number',
  'student name',
  'class/grade',
  'subject code',
  'subject name',
  'assessment type',
  'assessment name',
  'marks obtained',
  'max marks',
  'term',
  'academic year',
  'calculated grade',
  'grade points',
  'remarks',
]

function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index]
    if (quoted) {
      if (character === '"' && csv[index + 1] === '"') {
        cell += '"'
        index += 1
      } else if (character === '"') {
        quoted = false
      } else {
        cell += character
      }
    } else if (character === '"' && cell.length === 0) {
      quoted = true
    } else if (character === ',') {
      row.push(cell)
      cell = ''
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && csv[index + 1] === '\n') index += 1
      row.push(cell)
      if (row.some((value) => value.trim() !== '')) rows.push(row)
      row = []
      cell = ''
    } else {
      cell += character
    }
  }

  if (quoted) throw new Error('The CSV contains an unclosed quoted value.')
  if (cell.length > 0 || row.length > 0) {
    row.push(cell)
    if (row.some((value) => value.trim() !== '')) rows.push(row)
  }
  return rows
}

export function parseMarksCsv(csv: string): ParsedMarksCsv {
  const rows = parseCsvRows(csv)
  if (rows.length < 2) throw new Error('The CSV must contain a header row and at least one marks row.')

  const headers = rows[0].map((header) => header.replace(/^\uFEFF/, '').trim().toLowerCase())
  if (markHeaders.some((header) => !headers.includes(header))) {
    throw new Error(`The CSV must include these columns: ${markHeaders.join(', ')}.`)
  }
  if (new Set(headers).size !== headers.length) throw new Error('The CSV contains duplicate column names.')
  const positions = markHeaders.map((header) => headers.indexOf(header))

  const marks: ImportedMark[] = []
  const invalidRows: InvalidMarkRow[] = []
  rows.slice(1).forEach((values, index) => {
    if (values.length !== headers.length) {
      invalidRows.push({ row: index + 2, reason: 'Different number of columns from the header.' })
      return
    }
    const value = (position: number) => values[position].trim()
    const marksObtained = Number(value(positions[7]))
    const maxMarks = Number(value(positions[8]))
    const gradePointsValue = value(positions[12])
    const gradePoints = gradePointsValue === '' ? null : Number(gradePointsValue)
    if (
      !value(positions[0]) ||
      !value(positions[1]) ||
      !value(positions[3]) ||
      !value(positions[4]) ||
      !value(positions[5]) ||
      !value(positions[6]) ||
      !value(positions[9]) ||
      !value(positions[10]) ||
      !Number.isFinite(marksObtained) ||
      !Number.isFinite(maxMarks) ||
      maxMarks <= 0 ||
      maxMarks > 100000 ||
      marksObtained < 0 ||
      marksObtained > maxMarks ||
      gradePoints !== null && (!Number.isFinite(gradePoints) || gradePoints < 0) ||
      value(positions[0]).length > 50 ||
      value(positions[1]).length > 100 ||
      value(positions[2]).length > 50 ||
      value(positions[3]).length > 50 ||
      value(positions[4]).length > 100 ||
      value(positions[5]).length > 100 ||
      value(positions[6]).length > 150 ||
      value(positions[9]).length > 30 ||
      value(positions[10]).length > 20 ||
      value(positions[11]).length > 20 ||
      value(positions[13]).length > 500
    ) {
      invalidRows.push({ row: index + 2, reason: 'Missing required values or invalid marks, maximum marks, or grade points.' })
      return
    }
    marks.push({
      rowNumber: index + 2,
      studentNumber: value(positions[0]),
      studentName: value(positions[1]),
      classGrade: value(positions[2]),
      subjectCode: value(positions[3]),
      subjectName: value(positions[4]),
      assessmentType: value(positions[5]),
      assessmentName: value(positions[6]),
      marksObtained,
      maxMarks,
      term: value(positions[9]),
      academicYear: value(positions[10]),
      calculatedGrade: value(positions[11]),
      gradePoints,
      remarks: value(positions[13]),
    })
  })
  return { marks, invalidRows }
}

export interface ScheduleAssignment {
  id: string
  teacherId: string
  teacherEmail: string
  grade: string
  subject: string
  periodsPerWeek: number
}

export interface TimetableSlot {
  day: string
  period: number
  startsAt: string
  endsAt: string
  grade: string
  subject: string
  teacherId: string
  teacherEmail: string
}

const schoolDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
const lessonTimes = [
  ['08:30', '09:10'],
  ['09:10', '09:50'],
  ['10:20', '11:00'],
  ['11:00', '11:40'],
  ['12:40', '13:20'],
  ['13:20', '14:00'],
  ['14:10', '14:50'],
  ['14:50', '15:30'],
]

export function generateTimetable(assignments: ScheduleAssignment[]): TimetableSlot[] {
  const gradeLoads = new Map<string, number>()
  const teacherLoads = new Map<string, number>()
  for (const assignment of assignments) {
    gradeLoads.set(assignment.grade, (gradeLoads.get(assignment.grade) ?? 0) + assignment.periodsPerWeek)
    teacherLoads.set(assignment.teacherId, (teacherLoads.get(assignment.teacherId) ?? 0) + assignment.periodsPerWeek)
  }
  for (const [grade, load] of gradeLoads) {
    if (load > 40) throw new Error(`${grade} has ${load} lessons assigned; the weekly maximum is 40.`)
  }
  for (const [teacherId, load] of teacherLoads) {
    if (load > 40) {
      const teacher = assignments.find((item) => item.teacherId === teacherId)
      throw new Error(`${teacher?.teacherEmail ?? 'A teacher'} has ${load} lessons assigned; the weekly maximum is 40.`)
    }
  }

  const sessions = assignments.flatMap((assignment) =>
    Array.from({ length: assignment.periodsPerWeek }, (_, occurrence) => ({
      ...assignment,
      occurrence,
      sessionId: `${assignment.id}:${occurrence}`,
    })),
  )
  const gradeAt = new Map<string, string>()
  const teacherAt = new Map<string, string>()
  const placed = new Map<string, number>()
  const gradeSubjectDayLoad = new Map<string, number>()
  let attempts = 0
  const maxAttempts = 150_000

  function slotKey(slot: number) {
    return `${Math.floor(slot / 8)}-${slot % 8}`
  }

  function available(session: typeof sessions[number], slot: number) {
    const key = slotKey(slot)
    return !gradeAt.has(`${session.grade}-${key}`) && !teacherAt.has(`${session.teacherId}-${key}`)
  }

  const ordered = [...sessions].sort((first, second) => {
    const firstPressure = (gradeLoads.get(first.grade) ?? 0) + (teacherLoads.get(first.teacherId) ?? 0)
    const secondPressure = (gradeLoads.get(second.grade) ?? 0) + (teacherLoads.get(second.teacherId) ?? 0)
    return secondPressure - firstPressure || first.grade.localeCompare(second.grade) || first.subject.localeCompare(second.subject) || first.teacherEmail.localeCompare(second.teacherEmail) || first.occurrence - second.occurrence
  })
  function search(index: number): boolean {
    if (index === ordered.length) return true
    attempts += 1
    if (attempts > maxAttempts) return false
    const session = ordered[index]
    const previousSlot = session.occurrence > 0 ? placed.get(`${session.id}:${session.occurrence - 1}`) : undefined
    const candidates = Array.from({ length: 40 }, (_, slot) => slot)
      .filter((slot) => (previousSlot === undefined || slot > previousSlot) && available(session, slot))
      .sort((first, second) => {
        const firstDay = `${session.grade}|${session.subject}|${Math.floor(first / 8)}`
        const secondDay = `${session.grade}|${session.subject}|${Math.floor(second / 8)}`
        return (gradeSubjectDayLoad.get(firstDay) ?? 0) - (gradeSubjectDayLoad.get(secondDay) ?? 0) || first - second
      })

    for (const slot of candidates) {
      const key = slotKey(slot)
      const gradeKey = `${session.grade}-${key}`
      const teacherKey = `${session.teacherId}-${key}`
      const dayKey = `${session.grade}|${session.subject}|${Math.floor(slot / 8)}`
      gradeAt.set(gradeKey, session.sessionId)
      teacherAt.set(teacherKey, session.sessionId)
      placed.set(session.sessionId, slot)
      gradeSubjectDayLoad.set(dayKey, (gradeSubjectDayLoad.get(dayKey) ?? 0) + 1)
      if (search(index + 1)) return true
      gradeAt.delete(gradeKey)
      teacherAt.delete(teacherKey)
      placed.delete(session.sessionId)
      const dayLoad = gradeSubjectDayLoad.get(dayKey) ?? 1
      if (dayLoad === 1) gradeSubjectDayLoad.delete(dayKey)
      else gradeSubjectDayLoad.set(dayKey, dayLoad - 1)
    }
    return false
  }

  if (!search(0)) {
    throw new Error('A clash-free timetable could not be generated for these assignments. Reduce weekly lesson counts or change assignments.')
  }

  return ordered.map((session) => {
    const slot = placed.get(session.sessionId)!
    const [startsAt, endsAt] = lessonTimes[slot % 8]
    return {
      day: schoolDays[Math.floor(slot / 8)],
      period: (slot % 8) + 1,
      startsAt,
      endsAt,
      grade: session.grade,
      subject: session.subject,
      teacherId: session.teacherId,
      teacherEmail: session.teacherEmail,
    }
  }).sort((first, second) =>
    schoolDays.indexOf(first.day) - schoolDays.indexOf(second.day) ||
    first.period - second.period ||
    first.grade.localeCompare(second.grade),
  )
}
