const express = require('express');
const router = express.Router();
const getControllers = require('../controllers/api_GET_controllers');


// GET routes
// Get course details with assignments and users
router.get('/courses/:courseId', getControllers.getCourseDetail);
// Get assignment details
router.get('/assignments/:assignmentId', getControllers.getAssignmentInfo);
// Get student submission with grades
router.get('/assignments/:assignmentId/students/:studentId/submission', getControllers.getUserSubmission);
// AI grade a student's submission
router.get('/assignments/:assignmentId/user/:userId/ai-grading', getControllers.aiGradeSubmission);
// Check if a user exists by email
router.get("/users/check-exists/:email", getControllers.checkUserExists);


// DELETE routes

// Delete a course
router.delete('/courses/:courseId', deleteControllers.deleteCourse);
// Delete an enrollment (remove user from course)
router.delete('/enrollments/:enrollmentId', deleteControllers.deleteEnrollment);
// Delete a question
router.delete('/questions/:questionId', deleteControllers.deleteQuestion);

// PUT routes

// Update grading guidelines for an assignment
router.put("/assignments/grading-guidelines", putControllers.updateGradingGuidelines);
// Update question on an assignment
router.put("/questions", putControllers.updateQuestion);
// Update grade for a student's submission
router.put("/grades", putControllers.updateGrade);
// Update user role in a course
router.put("/enrollments/role", putControllers.updateRole);

module.exports = router;