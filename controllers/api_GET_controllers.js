const pool = require('../services/config');

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
        COUNT(DISTINCT ce.user_id) FILTER (WHERE u.account_type = 'STUDENT') as "totalStudents"
      FROM assignments a
      LEFT JOIN submissions s ON a.assignment_id = s.assignment_id
      LEFT JOIN course_enrollments ce ON a.course_id = ce.course_id
      LEFT JOIN users u ON ce.user_id = u.user_id AND u.account_type = 'STUDENT'
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

module.exports = {
  getCourseDetail,
  getAssignmentInfo,
  getUserSubmission
};