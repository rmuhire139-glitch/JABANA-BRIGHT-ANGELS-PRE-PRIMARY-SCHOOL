import { model, Schema } from 'mongoose'

export type SchoolRole = 'administrator' | 'dos' | 'teacher' | 'dos_teacher' | 'accountant'

const userSchema = new Schema(
  {
    email: { type: String, required: true, trim: true, lowercase: true, unique: true, maxlength: 254 },
    passwordHash: { type: String, required: true },
    authVersion: { type: Number, required: true, default: 0 },
    role: { type: String, required: true, enum: ['administrator', 'dos', 'teacher', 'dos_teacher', 'accountant'] },
    teacherName: { type: String, trim: true, maxlength: 100, default: '' },
    teacherStudies: { type: String, trim: true, maxlength: 500, default: '' },
    teacherGroupApproved: { type: Boolean, required: true, default: false },
    assignedCourses: { type: [String], default: [] },
    active: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
)

const sessionSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'SchoolUser', required: true },
  authVersion: { type: Number, required: true },
  tokenHash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
})

const passwordRecoverySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'SchoolUser', required: true, unique: true },
    codeHash: { type: String, required: true },
    attempts: { type: Number, required: true, default: 0 },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: true },
)

const taskStateSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'SchoolUser', required: true },
    taskKey: { type: String, required: true },
    completedAt: { type: Date, default: null },
    history: {
      type: [{ completed: { type: Boolean, required: true }, at: { type: Date, required: true } }],
      default: [],
    },
  },
  { timestamps: true },
)
taskStateSchema.index({ userId: 1, taskKey: 1 }, { unique: true })

const contactMessageSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    subject: { type: String, required: true, trim: true, maxlength: 150 },
    message: { type: String, required: true, trim: true, maxlength: 3000 },
    dismissedAt: { type: Date, default: null },
  },
  { timestamps: true },
)

const googleOAuthStateSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'SchoolUser', required: true },
    stateHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: true },
)

const schoolEmailConnectionSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, enum: ['school'] },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    encryptedRefreshToken: { type: String, required: true },
    tokenIv: { type: String, required: true },
    tokenAuthTag: { type: String, required: true },
    connectedBy: { type: Schema.Types.ObjectId, ref: 'SchoolUser', required: true },
    connectedAt: { type: Date, required: true },
  },
  { timestamps: true },
)

const admissionInquirySchema = new Schema(
  {
    studentName: { type: String, required: true, trim: true, maxlength: 100 },
    grade: {
      type: String,
      required: true,
      enum: ['Nursery 1', 'Nursery 2', 'Nursery 3', 'Primary 1', 'Primary 2', 'Primary 3', 'Primary 4'],
    },
    guardianName: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    phone: { type: String, required: true, trim: true, maxlength: 30 },
    message: { type: String, trim: true, maxlength: 2000, default: '' },
    status: { type: String, required: true, enum: ['new', 'contacted', 'closed', 'registered'], default: 'new' },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', default: null },
  },
  { timestamps: true },
)

const studentSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    grade: {
      type: String,
      required: true,
      enum: ['Nursery 1', 'Nursery 2', 'Nursery 3', 'Primary 1', 'Primary 2', 'Primary 3', 'Primary 4'],
    },
    guardianName: { type: String, trim: true, maxlength: 100, default: '' },
    guardianPhone: { type: String, trim: true, maxlength: 30, default: '' },
    sdmsCode: { type: String, trim: true, maxlength: 50 },
    admissionInquiryId: { type: Schema.Types.ObjectId, ref: 'AdmissionInquiry' },
    active: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
)
studentSchema.index({ sdmsCode: 1 }, { unique: true, sparse: true })
studentSchema.index({ admissionInquiryId: 1 }, { unique: true, sparse: true })

const studentMarkSchema = new Schema(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    studentNumber: { type: String, required: true, trim: true, maxlength: 50 },
    studentName: { type: String, required: true, trim: true, maxlength: 100 },
    classGrade: { type: String, trim: true, maxlength: 50, default: '' },
    subjectCode: { type: String, required: true, trim: true, maxlength: 50 },
    subjectName: { type: String, required: true, trim: true, maxlength: 100 },
    assessmentType: { type: String, required: true, trim: true, maxlength: 100 },
    assessmentName: { type: String, required: true, trim: true, maxlength: 150 },
    marksObtained: { type: Number, required: true, min: 0 },
    maxMarks: { type: Number, required: true, min: 0.01 },
    term: { type: String, required: true, trim: true, maxlength: 30 },
    academicYear: { type: String, required: true, trim: true, maxlength: 20 },
    calculatedGrade: { type: String, trim: true, maxlength: 20, default: '' },
    gradePoints: { type: Number, min: 0, default: null },
    remarks: { type: String, trim: true, maxlength: 500, default: '' },
    importedBy: { type: Schema.Types.ObjectId, ref: 'SchoolUser', required: true },
    importedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true },
)
studentMarkSchema.index(
  { studentNumber: 1, subjectCode: 1, assessmentType: 1, assessmentName: 1, term: 1, academicYear: 1 },
  { unique: true },
)
studentMarkSchema.index({ studentId: 1, academicYear: 1, term: 1 })

const teachingAssignmentSchema = new Schema(
  {
    academicYear: { type: String, required: true, trim: true, maxlength: 20 },
    teacherId: { type: Schema.Types.ObjectId, ref: 'SchoolUser', required: true },
    grade: {
      type: String,
      required: true,
      enum: ['Nursery 1', 'Nursery 2', 'Nursery 3', 'Primary 1', 'Primary 2', 'Primary 3', 'Primary 4'],
    },
    subject: { type: String, required: true, trim: true, maxlength: 100 },
    periodsPerWeek: { type: Number, required: true, min: 1, max: 40 },
  },
  { timestamps: true },
)
teachingAssignmentSchema.index({ academicYear: 1, teacherId: 1, grade: 1, subject: 1 }, { unique: true })

const timetableSlotSchema = new Schema(
  {
    day: { type: String, required: true, enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] },
    period: { type: Number, required: true, min: 1, max: 8 },
    startsAt: { type: String, required: true },
    endsAt: { type: String, required: true },
    grade: { type: String, required: true },
    subject: { type: String, required: true },
    teacherId: { type: Schema.Types.ObjectId, ref: 'SchoolUser', required: true },
    teacherEmail: { type: String, required: true, trim: true, lowercase: true },
  },
  { _id: false },
)
const classTimetableSchema = new Schema(
  {
    academicYear: { type: String, required: true, trim: true, maxlength: 20, unique: true },
    slots: { type: [timetableSlotSchema], default: [] },
    generatedBy: { type: Schema.Types.ObjectId, ref: 'SchoolUser', required: true },
    generatedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true },
)

const feePaymentSchema = new Schema(
  {
    amount: { type: Number, required: true, min: 1 },
    paidAt: { type: Date, required: true, default: Date.now },
    reference: { type: String, trim: true, maxlength: 100, default: '' },
  },
  { _id: true },
)

const studentFeeSchema = new Schema(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    academicYear: { type: String, required: true, trim: true, maxlength: 20 },
    term: { type: String, required: true, enum: ['Term 1', 'Term 2', 'Term 3'] },
    amountDue: { type: Number, required: true, min: 1 },
    payments: { type: [feePaymentSchema], default: [] },
  },
  { timestamps: true },
)
studentFeeSchema.index({ studentId: 1, academicYear: 1, term: 1 }, { unique: true })

const feeScheduleSchema = new Schema(
  {
    academicYear: { type: String, required: true, trim: true, maxlength: 20 },
    grade: {
      type: String,
      required: true,
      enum: ['Nursery 1', 'Nursery 2', 'Nursery 3', 'Primary 1', 'Primary 2', 'Primary 3', 'Primary 4'],
    },
    term: { type: String, required: true, enum: ['Term 1', 'Term 2', 'Term 3'] },
    amountDue: { type: Number, required: true, min: 1 },
  },
  { timestamps: true },
)
feeScheduleSchema.index({ academicYear: 1, grade: 1, term: 1 }, { unique: true })

const stockMovementSchema = new Schema(
  {
    type: { type: String, required: true, enum: ['restock', 'usage'] },
    quantity: { type: Number, required: true, min: 1 },
    note: { type: String, trim: true, maxlength: 150, default: '' },
    at: { type: Date, required: true, default: Date.now },
  },
  { _id: true },
)

const stockItemSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    category: { type: String, required: true, trim: true, maxlength: 60 },
    unit: { type: String, required: true, trim: true, maxlength: 30 },
    quantity: { type: Number, required: true, min: 0 },
    lowStockThreshold: { type: Number, required: true, min: 0 },
    movements: { type: [stockMovementSchema], default: [] },
  },
  { timestamps: true },
)

const feeAnnouncementSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    body: { type: String, required: true, trim: true, maxlength: 1500 },
    published: { type: Boolean, required: true, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'SchoolUser', required: true },
  },
  { timestamps: true },
)

export const SchoolUser = model('SchoolUser', userSchema)
export const SchoolSession = model('SchoolSession', sessionSchema)
export const PasswordRecovery = model('PasswordRecovery', passwordRecoverySchema)
export const TaskState = model('TaskState', taskStateSchema)
export const ContactMessage = model('ContactMessage', contactMessageSchema)
export const GoogleOAuthState = model('GoogleOAuthState', googleOAuthStateSchema)
export const SchoolEmailConnection = model('SchoolEmailConnection', schoolEmailConnectionSchema)
export const AdmissionInquiry = model('AdmissionInquiry', admissionInquirySchema)
export const Student = model('Student', studentSchema)
export const StudentMark = model('StudentMark', studentMarkSchema)
export const TeachingAssignment = model('TeachingAssignment', teachingAssignmentSchema)
export const ClassTimetable = model('ClassTimetable', classTimetableSchema)
export const StudentFee = model('StudentFee', studentFeeSchema)
export const FeeSchedule = model('FeeSchedule', feeScheduleSchema)
export const StockItem = model('StockItem', stockItemSchema)
export const FeeAnnouncement = model('FeeAnnouncement', feeAnnouncementSchema)
