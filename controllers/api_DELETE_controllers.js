const pool = require('../services/config');

/**
 * DELETE /api/courses/:courseId
 * Delete a course by ID
 */
const deleteCourse = async (req, res, next) => {
  const { courseId } = req.params;

  try {

    // Delete the enrollment
    const result = await pool.query(
      `DELETE FROM courses WHERE course_id = $1 RETURNING *`,
      [courseId]
    );

    // If course doesn't exist, return 404
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Course not found' });
    }

    res.json({
      message: 'Course and all related data deleted successfully'
    });
  } catch (err) {
    next(err);
  }
};


/**
 * DELETE /api/enrollments/:enrollmentId
 * Delete an enrollment (remove a user from a course)
 * Note: For an owner, need to delete a course before deleting enrollment associated with it
 */
const deleteEnrollment = async (req, res, next) => {
  try {
    
    const { enrollmentId } = req.params;
    
    // Check if enrollment exists and get details
    const checkQuery = `
      SELECT 
        ce.enrollment_id,
        ce.role,
        ce.course_id,
        u.first_name,
        u.last_name,
        c.course_name
      FROM course_enrollments ce
      INNER JOIN users u ON ce.user_id = u.user_id
      INNER JOIN courses c ON ce.course_id = c.course_id
      WHERE ce.enrollment_id = $1
    `;
    const checkResult = await pool.query(checkQuery, [enrollmentId]);
    
    // If enrollment doesn't exist, return 404
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Enrollment not found' });
    }
    
    const enrollment = checkResult.rows[0];
    
    // Check if trying to delete the only OWNER
    // Your database has a trigger for this, but we can catch it gracefully
    if (enrollment.role === 'OWNER') {
      const ownerCountQuery = `
        SELECT COUNT(*) as owner_count
        FROM course_enrollments
        WHERE course_id = $1 AND role = 'OWNER'
      `;
      const ownerCountResult = await pool.query(ownerCountQuery, [enrollment.course_id]);
      
      if (parseInt(ownerCountResult.rows[0].owner_count) === 1) {
        return res.status(400).json({ 
          error: 'Cannot delete the only owner of a course. Assign another owner first.' 
        });
      }
    }
    
    // Delete the enrollment
    const deleteQuery = `
      DELETE FROM course_enrollments
      WHERE enrollment_id = $1
      RETURNING enrollment_id, user_id, course_id, role
    `;
    const deleteResult = await pool.query(deleteQuery, [enrollmentId]);
    
    // Return success with details
    res.json({
      message: 'Enrollment deleted successfully'
    });
    
  } catch (error) {
    if (error.message && error.message.includes('only owner')) {
      return res.status(400).json({ 
        error: 'Cannot remove the only owner of a course' 
      });
    }
    console.error('Error deleting enrollment:', error);
    next(error);
  }
};

/**
 * DELETE /api/questions/:questionId
 * Delete a question from an assignment
 */
const deleteQuestion = async (req, res, next) => {
  try {

    const { questionId } = req.params;
    
    // Check if question exists
    const checkQuery = `
        SELECT question_id
        FROM questions
        WHERE question_id = $1
    `;
    const checkResult = await pool.query(checkQuery, [questionId]);
    
    // If question doesn't exist, return 404
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Question not found' });
    }
    
    const question = checkResult.rows[0];
    
    // Delete the question
    const deleteQuery = `
      DELETE FROM questions
      WHERE question_id = $1
      RETURNING question_id, question_number, question_text, max_points
    `;
    const deleteResult = await pool.query(deleteQuery, [questionId]);
    
    // Return success with details
    res.json({
      message: 'Question deleted successfully'
    });
    
  } catch (error) {
    console.error('Error deleting question:', error);
    next(error);
  }
};

// Export all DELETE controllers
module.exports = {
  deleteCourse,
  deleteEnrollment,
  deleteQuestion
};