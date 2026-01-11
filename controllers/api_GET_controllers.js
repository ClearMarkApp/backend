const pool = require('../services/config');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { gradeSubmission } = require('../services/gemini');

// R2 Client configuration (for fetching PDFs)
const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

/**
 * CourseDetailView - GET /api/courses/:courseId
 * Get course details with assignments and users
 */
const getCourseDetail = async (req, res, next) => {
  try {
    const { courseId } = req.params;
    
    // Get course info
    const courseQuery = `
      SELECT course_name as "courseName", course_code as "courseCode", colour as color
      FROM courses
      WHERE course_id = $1
    `;
    const courseResult = await pool.query(courseQuery, [courseId]);
    
    if (courseResult.rows.length === 0) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    const course = courseResult.rows[0];
    
    // Get assignments with submission counts
    const assignmentsQuery = `
      SELECT 
        a.assignment_id as id,
        a.title,
        a.submission_type as "submissionType",
        a.due_date as "dueDate",
        a.created_at as "createdAt",
        COUNT(DISTINCT s.submission_id) as "numSubmitted",
        COUNT(DISTINCT ce.user_id) FILTER (WHERE u.account_type = 'STUDENT' AND ce.role = 'STUDENT') as "totalStudents"
      FROM assignments a
      LEFT JOIN submissions s ON a.assignment_id = s.assignment_id
      LEFT JOIN course_enrollments ce ON a.course_id = ce.course_id
      LEFT JOIN users u ON ce.user_id = u.user_id AND u.account_type = 'STUDENT' AND ce.role = 'STUDENT'
      WHERE a.course_id = $1
      GROUP BY a.assignment_id, a.title, a.submission_type, a.due_date, a.created_at
      ORDER BY a.due_date DESC NULLS LAST, a.created_at DESC
    `;
    const assignmentsResult = await pool.query(assignmentsQuery, [courseId]);
    
    // Get users enrolled in course (with enrollmentId added)
    const usersQuery = `
      SELECT 
        u.user_id as id,
        u.first_name as "firstName",
        u.last_name as "lastName",
        u.email,
        ce.role,
        ce.enrollment_id as "enrollmentId"
      FROM users u
      INNER JOIN course_enrollments ce ON u.user_id = ce.user_id
      WHERE ce.course_id = $1
      ORDER BY ce.role, u.last_name, u.first_name
    `;
    const usersResult = await pool.query(usersQuery, [courseId]);
    
    res.json({
      courseName: course.courseName,
      courseCode: course.courseCode,
      color: course.color,
      assignments: assignmentsResult.rows.map(row => ({
        id: row.id,
        title: row.title,
        submissionType: row.submissionType,
        dueDate: row.dueDate,
        createdAt: row.createdAt,
        numSubmitted: parseInt(row.numSubmitted),
        totalStudents: parseInt(row.totalStudents)
      })),
      users: usersResult.rows
    });
  } catch (error) {
    next(error);
  }
};

/**
 * AssignmentInfoView - GET /api/assignments/:assignmentId
 * Get assignment details with questions, users, submissions, and grades
 */
const getAssignmentInfo = async (req, res, next) => {
  try {
    const { assignmentId } = req.params;
    
    // Get assignment info
    const assignmentQuery = `
      SELECT 
        assignment_id as id,
        title,
        submission_type as "submissionType",
        due_date as "dueDate",
        grading_guidelines as "gradingGuidelines"
      FROM assignments
      WHERE assignment_id = $1
    `;
    const assignmentResult = await pool.query(assignmentQuery, [assignmentId]);
    
    if (assignmentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Assignment not found' });
    }
    
    const assignment = assignmentResult.rows[0];
    
    // Get questions
    const questionsQuery = `
      SELECT 
        question_id as id,
        question_number as "questionNumber",
        question_text as "questionText",
        max_points as "maxPoints",
        solution_key as "solutionKey"
      FROM questions
      WHERE assignment_id = $1
      ORDER BY question_number
    `;
    const questionsResult = await pool.query(questionsQuery, [assignmentId]);
    
    // Parse maxPoints to number
    const questions = questionsResult.rows.map(q => ({
      ...q,
      maxPoints: parseFloat(q.maxPoints)
    }));

    // Calculate total assignment marks
    const totalAssignmentMarks = questions.reduce((sum, q) => sum + q.maxPoints, 0);

    // Get users in the course
    const usersQuery = `
      SELECT 
        u.user_id as id,
        u.first_name as "firstName",
        u.last_name as "lastName",
        u.email,
        ce.role
      FROM users u
      INNER JOIN course_enrollments ce ON u.user_id = ce.user_id
      INNER JOIN assignments a ON ce.course_id = a.course_id
      WHERE a.assignment_id = $1
      ORDER BY u.last_name, u.first_name
    `;
    const usersResult = await pool.query(usersQuery, [assignmentId]);
    
    // Get submissions for students
    const submissionsQuery = `
      SELECT 
        s.submission_id as id,
        s.student_id,
        s.status
      FROM submissions s
      WHERE s.assignment_id = $1
      AND s.submission_id IN (
        SELECT MAX(submission_id) 
        FROM submissions 
        WHERE assignment_id = $1 
        GROUP BY student_id
      )
    `;
    const submissionsResult = await pool.query(submissionsQuery, [assignmentId]);
    
    // Get grades (total score per student)
    const gradesQuery = `
      SELECT 
        s.student_id,
        s.submission_id as id,
        SUM(g.grade) as score
      FROM submissions s
      INNER JOIN grades g ON s.submission_id = g.submission_id
      WHERE s.assignment_id = $1
      AND s.submission_id IN (
        SELECT MAX(submission_id) 
        FROM submissions 
        WHERE assignment_id = $1 
        GROUP BY student_id
      )
      GROUP BY s.student_id, s.submission_id
    `;
    const gradesResult = await pool.query(gradesQuery, [assignmentId]);
    
    // Convert to dictionaries
    const usersById = {};
    usersResult.rows.forEach(user => {
      usersById[user.id] = user;
    });
    
    const submissionsByStudentId = {};
    submissionsResult.rows.forEach(sub => {
      submissionsByStudentId[sub.student_id] = {
        id: sub.id,
        status: sub.status
      };
    });
    
    const gradesByStudentId = {};
    gradesResult.rows.forEach(grade => {
      gradesByStudentId[grade.student_id] = {
        id: grade.id,
        score: parseFloat(grade.score)
      };
    });
    
    res.json({
      id: assignment.id,
      title: assignment.title,
      submissionType: assignment.submissionType,
      dueDate: assignment.dueDate,
      gradingGuidelines: assignment.gradingGuidelines,
      totalAssignmentMarks: totalAssignmentMarks,
      questions: questions,
      usersById: usersById,
      submissionsByStudentId: submissionsByStudentId,
      gradesByStudentId: gradesByStudentId
    });
  } catch (error) {
    next(error);
  }
};

/**
 * UserSubmissionView - GET /api/assignments/:assignmentId/students/:studentId/submission
 * Get user submission details with grades
 */
const getUserSubmission = async (req, res, next) => {
  try {
    const { assignmentId, studentId } = req.params;
    
    // Get user info
    const userQuery = `
      SELECT 
        first_name as "firstName",
        last_name as "lastName",
        email
      FROM users
      WHERE user_id = $1
    `;
    const userResult = await pool.query(userQuery, [studentId]);
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const user = userResult.rows[0];
    
    // Get latest submission
    const submissionQuery = `
      SELECT
        file_key,
        status
      FROM submissions
      WHERE assignment_id = $1 AND student_id = $2
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const submissionResult = await pool.query(submissionQuery, [assignmentId, studentId]);

    let submission = null;
    if (submissionResult.rows.length > 0) {
      const row = submissionResult.rows[0];
      submission = {
        imageUrl: row.file_key ? `${process.env.R2_PUBLIC_URL}/${row.file_key}` : null,
        status: row.status
      };
    }
    
    // Get grades with question details
    const gradesQuery = `
      SELECT 
        g.grade_id as id,
        g.grade,
        g.feedback,
        q.max_points as "maxPoints",
        q.question_number as "questionNumber",
        q.question_text as "questionText"
      FROM grades g
      INNER JOIN questions q ON g.question_id = q.question_id
      INNER JOIN submissions s ON g.submission_id = s.submission_id
      WHERE s.assignment_id = $1 AND s.student_id = $2
      AND s.submission_id = (
        SELECT submission_id 
        FROM submissions 
        WHERE assignment_id = $1 AND student_id = $2 
        ORDER BY created_at DESC 
        LIMIT 1
      )
      ORDER BY q.question_number
    `;
    const gradesResult = await pool.query(gradesQuery, [assignmentId, studentId]);
    
    // Parse grade and maxPoints to numbers
    const grades = gradesResult.rows.map(g => ({
      ...g,
      grade: parseFloat(g.grade),
      maxPoints: parseFloat(g.maxPoints)
    }));
    
    res.json({
      user: user,
      submission: submission,
      grades: grades
    });
  } catch (error) {
    next(error);
  }
};

/**
 * AIGradeSubmission - GET /api/assignments/:assignmentId/user/:userId/ai-grading
 * Use AI to grade a student's submission and update the database
 */
const aiGradeSubmission = async (req, res, next) => {
  const client = await pool.connect();

  try {
    const { assignmentId, userId } = req.params;

    // Get assignment with grading guidelines
    const assignmentQuery = `
      SELECT
        assignment_id as id,
        title,
        grading_guidelines as "gradingGuidelines"
      FROM assignments
      WHERE assignment_id = $1
    `;
    const assignmentResult = await client.query(assignmentQuery, [assignmentId]);

    if (assignmentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    const assignment = assignmentResult.rows[0];

    // Get questions for this assignment
    const questionsQuery = `
      SELECT
        question_id as id,
        question_number as "questionNumber",
        question_text as "questionText",
        max_points as "maxPoints",
        solution_key as "solutionKey"
      FROM questions
      WHERE assignment_id = $1
      ORDER BY question_number
    `;
    const questionsResult = await client.query(questionsQuery, [assignmentId]);

    if (questionsResult.rows.length === 0) {
      return res.status(400).json({ error: 'No questions found for this assignment' });
    }

    const questions = questionsResult.rows.map(q => ({
      ...q,
      maxPoints: parseFloat(q.maxPoints)
    }));

    // Get the user's latest submission
    const submissionQuery = `
      SELECT
        submission_id as id,
        file_key as "fileKey"
      FROM submissions
      WHERE assignment_id = $1 AND student_id = $2
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const submissionResult = await client.query(submissionQuery, [assignmentId, userId]);

    if (submissionResult.rows.length === 0) {
      return res.status(404).json({ error: 'No submission found for this user' });
    }

    const submission = submissionResult.rows[0];

    if (!submission.fileKey) {
      return res.status(400).json({ error: 'Submission has no file' });
    }

    // Fetch the PDF from R2
    const getCommand = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: submission.fileKey,
    });

    const r2Response = await r2Client.send(getCommand);

    // Convert stream to buffer
    const chunks = [];
    for await (const chunk of r2Response.Body) {
      chunks.push(chunk);
    }
    const pdfBuffer = Buffer.concat(chunks);

    // Call Gemini AI to grade the submission
    const gradingResults = await gradeSubmission(
      pdfBuffer,
      questions,
      assignment.gradingGuidelines
    );

    // Begin transaction to update grades
    await client.query('BEGIN');

    // Delete existing grades for this submission
    await client.query(
      `DELETE FROM grades WHERE submission_id = $1`,
      [submission.id]
    );

    // Insert new grades for each question
    for (const gradeItem of gradingResults.grades) {
      await client.query(
        `
        INSERT INTO grades (submission_id, question_id, grade, feedback)
        VALUES ($1, $2, $3, $4)
        `,
        [submission.id, gradeItem.question_id, gradeItem.grade, gradeItem.feedback]
      );
    }

    // Update submission status to GRADED
    await client.query(
      `UPDATE submissions SET status = 'GRADED' WHERE submission_id = $1`,
      [submission.id]
    );

    await client.query('COMMIT');

    res.json({ message: 'AI grading completed successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('AI grading error:', error);
    next(error);
  } finally {
    client.release();
  }
};

/**
 * ExportAssignmentCsv - GET /api/assignments/:assignmentId/export
 * Export assignment submissions and grades as CSV
 */
const exportAssignmentCsv = async (req, res, next) => {
  try {
    const { assignmentId } = req.params;

    // Get assignment title
    const assignmentQuery = `
      SELECT title
      FROM assignments
      WHERE assignment_id = $1
    `;
    const assignmentResult = await pool.query(assignmentQuery, [assignmentId]);

    if (assignmentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    const assignmentTitle = assignmentResult.rows[0].title;

    // Get all questions for this assignment (ordered by question_id)
    const questionsQuery = `
      SELECT
        question_id,
        question_number
      FROM questions
      WHERE assignment_id = $1
      ORDER BY question_id
    `;
    const questionsResult = await pool.query(questionsQuery, [assignmentId]);
    const questions = questionsResult.rows;

    // Get all submissions with student info
    const submissionsQuery = `
      SELECT
        s.submission_id,
        u.email,
        u.first_name,
        u.last_name
      FROM submissions s
      INNER JOIN users u ON s.student_id = u.user_id
      WHERE s.assignment_id = $1
      ORDER BY u.last_name, u.first_name
    `;
    const submissionsResult = await pool.query(submissionsQuery, [assignmentId]);
    const submissions = submissionsResult.rows;

    // Get all grades for this assignment's submissions
    const gradesQuery = `
      SELECT
        g.submission_id,
        g.question_id,
        g.grade,
        g.feedback
      FROM grades g
      INNER JOIN submissions s ON g.submission_id = s.submission_id
      WHERE s.assignment_id = $1
    `;
    const gradesResult = await pool.query(gradesQuery, [assignmentId]);

    // Build a lookup map: submission_id -> question_id -> {grade, feedback}
    const gradesMap = {};
    gradesResult.rows.forEach(g => {
      if (!gradesMap[g.submission_id]) {
        gradesMap[g.submission_id] = {};
      }
      gradesMap[g.submission_id][g.question_id] = {
        grade: g.grade,
        feedback: g.feedback
      };
    });

    // Build CSV header
    const headers = ['Submission ID', 'Student Email', 'Student Name'];
    questions.forEach(q => {
      headers.push(`Q${q.question_number} Grade`);
      headers.push(`Q${q.question_number} Feedback`);
    });

    // Helper function to escape CSV fields
    const escapeCsvField = (field) => {
      if (field === null || field === undefined) {
        return '';
      }
      const str = String(field);
      if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    // Build CSV rows
    const rows = [];
    rows.push(headers.map(escapeCsvField).join(','));

    submissions.forEach(sub => {
      const row = [
        sub.submission_id,
        sub.email,
        `${sub.first_name} ${sub.last_name}`
      ];

      questions.forEach(q => {
        const gradeData = gradesMap[sub.submission_id]?.[q.question_id];
        row.push(gradeData?.grade ?? '');
        row.push(gradeData?.feedback ?? '');
      });

      rows.push(row.map(escapeCsvField).join(','));
    });

    const csvContent = rows.join('\n');

    // Set headers for CSV download
    const safeTitle = assignmentTitle.replace(/[^a-zA-Z0-9]/g, '_');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}_export.csv"`);
    res.send(csvContent);
  } catch (error) {
    next(error);
  }
};

/**
 * CheckUserExists - GET /api/users/check-exists/:email
 * Check if a user exists by email
 */
const checkUserExists = async (req, res, next) => {
  try {
    const { email } = req.params;

    const query = `
      SELECT EXISTS(SELECT 1 FROM users WHERE email = $1) as exists
    `;
    const result = await pool.query(query, [email]);

    res.json({
      exists: result.rows[0].exists
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getCourseDetail,
  getAssignmentInfo,
  getUserSubmission,
  aiGradeSubmission,
  exportAssignmentCsv,
  checkUserExists
};