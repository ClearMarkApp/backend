const pool = require('../services/config');

/**
 * UpdateGradingGuidelines - PUT /api/assignments/grading-guidelines
 * Update the grading guidelines for an assignment
 */
const updateGradingGuidelines = async (req, res) => {
  const { assignmentId, gradingGuidelines } = req.body;

  try {
    const result = await pool.query(
      `
      UPDATE assignments
      SET grading_guidelines = $1
      WHERE assignment_id = $2
      RETURNING *
      `,
      [gradingGuidelines, assignmentId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Assignment not found" });
    }

    res.json({
      message: 'Grade guidelines updated successfully'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update grading guidelines" });
  }
};

/**
 * UpdateQuestion - PUT /api/questions
 * Update the question on an assignment
 */
const updateQuestion = async (req, res) => {
  const {
    questionId,
    questionNumber,
    questionText,
    maxPoints,
    solutionKey
  } = req.body;

  try {
    const result = await pool.query(
      `
      UPDATE questions
      SET
        question_number = $1,
        question_text = $2,
        max_points = $3,
        solution_key = $4
      WHERE question_id = $5
      RETURNING *
      `,
      [questionNumber, questionText, maxPoints, solutionKey, questionId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Question not found" });
    }

    res.json({
      message: 'Question updated successfully'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update question" });
  }
};

/**
 * UpdateGrade - PUT /api/grades
 * Update the grade for a student's submission
 */
const updateGrade = async (req, res) => {
  const { gradeId, grade, feedback } = req.body;

  try {
    const result = await pool.query(
      `
      UPDATE grades
      SET
        grade = $1,
        feedback = $2
      WHERE grade_id = $3
      RETURNING *
      `,
      [grade, feedback, gradeId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Grade not found" });
    }

    res.json({
      message: 'Grade updated successfully'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update grade" });
  }
};

/**
 * UpdateRole - PUT /api/enrollments/role
 * Update the role for a user in a course
 */
const updateRole = async (req, res) => {
  const { enrollmentId, newRole } = req.body;

  try {
    const result = await pool.query(
      `
      UPDATE course_enrollments
      SET role = $1
      WHERE enrollment_id = $2
      RETURNING *
      `,
      [newRole, enrollmentId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Enrollment not found" });
    }

    res.json({
      message: 'Role updated successfully'
    });
  } catch (err) {
    console.error(err);

    // Trigger-safe error handling
    if (err.code === "P0001") {
      return res.status(400).json({ error: err.message });
    }

    res.status(500).json({ error: "Failed to update role" });
  }
};

module.exports = {
    updateGradingGuidelines,
    updateQuestion,
    updateGrade,
    updateRole
};