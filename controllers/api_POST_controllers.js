const pool = require('../services/config');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

// R2 Client configuration
const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

/**
 * CreateQuestion - POST /api/questions
 * Create a new question in an assignment
 */
const createQuestion = async (req, res) => {
  const { assignmentId, questionNumber, questionText, maxPoints, solutionKey} = req.body;

  try {
    const result = await pool.query(
      `
      INSERT INTO questions (
        assignment_id,
        question_number,
        question_text,
        max_points,
        solution_key
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
      `,
      [assignmentId, questionNumber, questionText, maxPoints, solutionKey]
    );

    res.json({
      message: 'Question created successfully'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create question" });
  }
};

/**
 * CreateAssignment - POST /api/assignments
 * Create a new assignment in a course 
 */
const createAssignment = async (req, res) => {
  const { courseId, title, submissionType, dueDate, gradingGuidelines } = req.body;

  try {
    const result = await pool.query(
      `
      INSERT INTO assignments (
        course_id,
        title,
        submission_type,
        due_date,
        grading_guidelines
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
      `,
      [courseId, title, submissionType, dueDate, gradingGuidelines]
    );

    res.json({
      message: 'Assignment created successfully'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create assignment" });
  }
};

/**
 * CreateCourse - POST /api/courses
 * Create a new course for a user (owner)
 */
const createCourse = async (req, res) => {
  const { courseCode, courseName, color, email } = req.body;

  const client = await pool.connect();

  try {
    // Look up userId from email
    const userResult = await client.query(
      `SELECT user_id FROM users WHERE email = $1`,
      [email]
    );

    if (userResult.rowCount === 0) {
      client.release();
      return res.status(404).json({ error: "User not found" });
    }

    const userId = userResult.rows[0].user_id;

    await client.query("BEGIN");

    const courseResult = await client.query(
      `
      INSERT INTO courses (
        course_code,
        course_name,
        colour
      )
      VALUES ($1, $2, $3)
      RETURNING course_id
      `,
      [courseCode, courseName, color]
    );

    const courseId = courseResult.rows[0].course_id;

    await client.query(
      `
      INSERT INTO course_enrollments (
        user_id,
        course_id,
        role
      )
      VALUES ($1, $2, 'OWNER')
      `,
      [userId, courseId]
    );

    await client.query("COMMIT");
    res.json({
      message: 'Course created successfully'
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Failed to create course" });
  } finally {
    client.release();
  }
};

/**
 * CreateEnrollment - POST /api/enrollments
 * Create a new enrollment for a user in a course
 */
const createEnrollment = async (req, res) => {
  const { email, courseId } = req.body;

  try {
    const userResult = await pool.query(
      `
      SELECT user_id
      FROM users
      WHERE email = $1
      `,
      [email]
    );

    if (userResult.rowCount === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const userId = userResult.rows[0].user_id;

    const enrollmentResult = await pool.query(
      `
      INSERT INTO course_enrollments (
        user_id,
        course_id,
        role
      )
      VALUES ($1, $2, 'STUDENT')
      RETURNING *
      `,
      [userId, courseId]
    );

    res.json({
      message: 'Created enrollment successfully'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to enroll user" });
  }
};

/**
 * CreateUser - POST /api/users
 * Create a new user
 */
const createUser = async (req, res) => {
  const { firstName, lastName, email, accountType } = req.body;

  try {
    const result = await pool.query(
      `
      INSERT INTO users (
        first_name,
        last_name,
        email,
        account_type
      )
      VALUES ($1, $2, $3, $4)
      RETURNING *
      `,
      [firstName, lastName, email, accountType]
    );

    res.json({
      message: 'User created successfully'
    });
  } catch (err) {
    console.error(err);

    if (err.code === "23505") {
      return res.status(409).json({ error: "Email already exists" });
    }

    res.status(500).json({ error: "Failed to create user" });
  }
};


/**
 * ClassListView - POST /api/users/classes
 * Get all classes for a user (owner)
 */
const postUserClasses = async (req, res, next) => {
  try {

    const { email } = req.body;

    if(!email){
        return res.status(400).json({ error: 'Missing email' });
    }

    const userQuery = `
        SELECT user_id
        FROM users
        WHERE email = $1
    `;
    // console.log('2. About to query database with email:', email);

    const userResult = await pool.query(userQuery, [email]);
    
    // console.log('3. Query result:', userResult);
    // console.log('4. Rows:', userResult.rows);

    if(userResult.rows.length === 0){
        return res.status(400).json({ error: 'User not found' });
    }

    const userId = userResult.rows[0].user_id;
    const query = `
      SELECT 
        c.course_id as id,
        c.colour as color,
        c.course_name as "courseName",
        c.course_code as "courseCode",
        COUNT(DISTINCT ce2.user_id) FILTER (WHERE u2.account_type = 'STUDENT' AND ce2.role = 'STUDENT') as headcount,
        u.first_name || ' ' || u.last_name as owner
      FROM courses c
      INNER JOIN course_enrollments ce ON c.course_id = ce.course_id
      INNER JOIN users u ON ce.user_id = u.user_id
      LEFT JOIN course_enrollments ce2 ON c.course_id = ce2.course_id
      LEFT JOIN users u2 ON ce2.user_id = u2.user_id
      WHERE ce.user_id = $1 AND ce.role = 'OWNER'
      GROUP BY c.course_id, c.colour, c.course_name, c.course_code, u.first_name, u.last_name
      ORDER BY c.created_at DESC
    `;
    
    const result = await pool.query(query, [userId]);

    res.json({
      classes: result.rows.map(row => ({
        id: row.id,
        color: row.color,
        courseName: row.courseName,
        courseCode: row.courseCode,
        headcount: parseInt(row.headcount),
        owner: row.owner
      }))
    });
  } catch (error) {
    next(error);
  }
};

/**
 * UploadSubmission - POST /api/users/:userId/assignments/:assignmentId/upload
 * Upload a PDF submission to R2 and save file key in database
 * Deletes any previous submissions for the same assignment/user
 */
const uploadSubmission = async (req, res) => {
  const { userId, assignmentId } = req.params;

  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    // Get old submissions to delete their files from R2
    const oldSubmissions = await pool.query(
      `SELECT file_key FROM submissions WHERE assignment_id = $1 AND student_id = $2`,
      [assignmentId, userId]
    );

    // Delete old files from R2
    for (const row of oldSubmissions.rows) {
      if (row.file_key) {
        try {
          await r2Client.send(new DeleteObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Key: row.file_key,
          }));
        } catch (deleteErr) {
          console.error('Failed to delete old file from R2:', deleteErr);
        }
      }
    }

    // Delete old submissions from database
    await pool.query(
      `DELETE FROM submissions WHERE assignment_id = $1 AND student_id = $2`,
      [assignmentId, userId]
    );

    // Generate a unique file key
    const timestamp = Date.now();
    const fileKey = `submissions/${assignmentId}/${userId}/${timestamp}.pdf`;

    // Upload to R2
    const uploadCommand = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: fileKey,
      Body: req.file.buffer,
      ContentType: 'application/pdf',
    });

    await r2Client.send(uploadCommand);

    // Insert new submission in database
    await pool.query(
      `
      INSERT INTO submissions (
        assignment_id,
        student_id,
        file_key,
        status
      )
      VALUES ($1, $2, $3, 'SUBMITTED')
      `,
      [assignmentId, userId, fileKey]
    );

    res.json({
      message: 'Submission uploaded successfully'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to upload submission' });
  }
};

module.exports = {
  createQuestion,
  createAssignment,
  createEnrollment,
  createUser,
  createCourse,
  postUserClasses,
  uploadSubmission
};
